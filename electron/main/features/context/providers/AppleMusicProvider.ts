import { createLogger } from "../../../infra/log";
import { isAutomationDenied, runAppleScript } from "../applescript";
import type {
	BackgroundContext,
	ContentDescriptor,
	ContentKind,
	ContextEnrichment,
	ForegroundSnapshot,
	UrlMetadata,
} from "../types";
import type { BackgroundCapableProvider } from "./types";

const logger = createLogger({ scope: "AppleMusicProvider" });

const APPLE_MUSIC_BUNDLE_IDS = new Set(["com.apple.Music"]);

const APPLE_MUSIC_STATE_SCRIPT = `
if application "Music" is running then
  tell application "Music"
    if player state is stopped then
      return "stopped"
    end if
    set currentTrack to current track
    set trackName to name of currentTrack
    set artistName to artist of currentTrack
    set albumName to album of currentTrack
    set trackDatabaseId to database ID of currentTrack
    set playerState to player state as string
    try
      set trackPersistentId to persistent ID of currentTrack
    on error
      set trackPersistentId to ""
    end try
    return playerState & "|||" & trackDatabaseId & "|||" & trackName & "|||" & artistName & "|||" & albumName & "|||" & trackPersistentId
  end tell
else
  return "not_running"
end if
`;

interface AppleMusicParsedId {
	type: "song" | "podcast_episode";
	id: string;
	persistentId: string;
}

interface AppleMusicTrackData {
	playerState: string;
	databaseId: string;
	trackName: string;
	artistName: string;
	albumName: string;
	persistentId: string;
	parsed: AppleMusicParsedId;
}

function parseAppleMusicId(
	databaseId: string,
	persistentId: string,
): AppleMusicParsedId | null {
	if (!databaseId || databaseId === "0") {
		return null;
	}

	return {
		type: "song",
		id: databaseId,
		persistentId: persistentId || databaseId,
	};
}

interface ITunesSearchResult {
	trackId?: number;
	trackName?: string;
	artistName?: string;
	artworkUrl100?: string;
}

interface ITunesSearchResponse {
	resultCount: number;
	results: ITunesSearchResult[];
}

interface CatalogLookupResult {
	catalogId: string;
	artworkUrl: string | null;
}

const catalogCache = new Map<string, CatalogLookupResult | null>();

function simplifyTrackName(name: string): string {
	return name
		.replace(/\s*\(feat\..*?\)/gi, "")
		.replace(/\s*\[feat\..*?\]/gi, "")
		.replace(/\s*ft\..*$/gi, "")
		.replace(/\s*\/.*$/, "")
		.trim();
}

function normalizeForComparison(text: string): string {
	return text
		.toLowerCase()
		.replace(/['']/g, "'")
		.replace(/[^\w\s']/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

async function lookupCatalog(
	trackName: string,
	artistName: string,
): Promise<CatalogLookupResult | null> {
	const cacheKey = `${trackName}:::${artistName}`;
	if (catalogCache.has(cacheKey)) {
		return catalogCache.get(cacheKey) ?? null;
	}

	try {
		const simplifiedTrack = simplifyTrackName(trackName);
		const searchTerm = encodeURIComponent(`${simplifiedTrack} ${artistName}`);
		const url = `https://itunes.apple.com/search?term=${searchTerm}&media=music&entity=song&limit=10`;

		const response = await fetch(url, {
			signal: AbortSignal.timeout(3000),
		});

		if (!response.ok) {
			logger.debug("iTunes Search API error", { status: response.status });
			return null;
		}

		const data = (await response.json()) as ITunesSearchResponse;

		if (!data.results || data.results.length === 0) {
			catalogCache.set(cacheKey, null);
			return null;
		}

		const trackNorm = normalizeForComparison(simplifiedTrack);
		const artistNorm = normalizeForComparison(artistName);

		for (const result of data.results) {
			const resultTrack = normalizeForComparison(result.trackName ?? "");
			const resultArtist = normalizeForComparison(result.artistName ?? "");

			const trackMatches =
				resultTrack.includes(trackNorm) || trackNorm.includes(resultTrack);
			const artistMatches =
				resultArtist.includes(artistNorm) || artistNorm.includes(resultArtist);

			if (trackMatches && artistMatches && result.trackId) {
				const lookupResult: CatalogLookupResult = {
					catalogId: result.trackId.toString(),
					artworkUrl:
						result.artworkUrl100?.replace("100x100", "300x300") ?? null,
				};
				catalogCache.set(cacheKey, lookupResult);
				logger.debug("Found catalog via iTunes Search", {
					trackName,
					simplifiedTrack,
					artistName,
					catalogId: lookupResult.catalogId,
					hasArtwork: !!lookupResult.artworkUrl,
				});
				return lookupResult;
			}
		}

		catalogCache.set(cacheKey, null);
		return null;
	} catch (error) {
		logger.debug("iTunes Search lookup failed", { error: String(error) });
		return null;
	}
}

function appleMusicTypeToContentKind(
	type: "song" | "podcast_episode",
): ContentKind {
	switch (type) {
		case "song":
			return "apple_music_track";
		case "podcast_episode":
			return "apple_music_episode";
		default:
			return "apple_music_track";
	}
}

type AutomationState = "not-attempted" | "granted" | "denied";

let automationState: AutomationState = "not-attempted";
let lastAutomationError: string | null = null;

async function fetchAppleMusicState(): Promise<
	AppleMusicTrackData | "stopped" | "not_running" | null
> {
	const result = await runAppleScript(APPLE_MUSIC_STATE_SCRIPT);

	if (!result.success) {
		if (isAutomationDenied(result.error)) {
			automationState = "denied";
			lastAutomationError = result.error;
			logger.warn("Automation permission denied for Music");
		}
		return null;
	}

	const output = result.output.trim();

	if (output === "stopped") return "stopped";
	if (output === "not_running") return "not_running";

	const parts = output.split("|||");
	if (parts.length < 5) {
		logger.debug("Unexpected Apple Music output format", { output });
		return null;
	}

	const [
		playerState,
		databaseId,
		trackName,
		artistName,
		albumName,
		persistentId,
	] = parts;

	const parsed = parseAppleMusicId(databaseId, persistentId || "");
	if (!parsed) {
		logger.debug("Failed to parse Apple Music ID", { databaseId });
		return null;
	}

	automationState = "granted";
	lastAutomationError = null;

	logger.debug("Apple Music track state", {
		trackName,
		artistName,
		databaseId,
		persistentId,
	});

	return {
		playerState,
		databaseId,
		trackName,
		artistName,
		albumName,
		persistentId: persistentId || databaseId,
		parsed,
	};
}

export const appleMusicProvider: BackgroundCapableProvider = {
	id: "apple_music",
	priority: 10,

	supports(snapshot: ForegroundSnapshot): boolean {
		return APPLE_MUSIC_BUNDLE_IDS.has(snapshot.app.bundleId);
	},

	async collect(
		snapshot: ForegroundSnapshot,
	): Promise<ContextEnrichment | null> {
		if (!this.supports(snapshot)) return null;

		const state = await fetchAppleMusicState();

		if (!state || state === "stopped" || state === "not_running") {
			logger.debug("Apple Music not playing", { state });
			return null;
		}

		const catalog = await lookupCatalog(state.trackName, state.artistName);
		const contentKind = appleMusicTypeToContentKind(state.parsed.type);
		const actionUrl = catalog
			? `itms://music.apple.com/song/${catalog.catalogId}`
			: null;
		const canonicalUrl = actionUrl || `applemusic:track:${state.parsed.id}`;

		const content: ContentDescriptor = {
			kind: contentKind,
			id: state.parsed.id,
			title: state.trackName || null,
			urlCanonical: canonicalUrl,
			subtitle: state.artistName || null,
			imageUrl: catalog?.artworkUrl ?? null,
			metadata: {
				album: state.albumName || null,
				playerState: state.playerState,
				persistentId: state.parsed.persistentId,
				catalogId: catalog?.catalogId ?? null,
			},
		};

		const url: UrlMetadata | null = actionUrl
			? {
					urlCanonical: actionUrl,
					host: "music.apple.com",
					title: state.trackName || null,
				}
			: null;

		return {
			url,
			content,
			confidence: 0.95,
		};
	},

	async collectBackground(): Promise<BackgroundContext | null> {
		const state = await fetchAppleMusicState();

		if (!state || state === "stopped" || state === "not_running") {
			return null;
		}

		if (state.playerState !== "playing") {
			return null;
		}

		const catalog = await lookupCatalog(state.trackName, state.artistName);
		const contentKind = appleMusicTypeToContentKind(state.parsed.type);
		const actionUrl = catalog
			? `itms://music.apple.com/song/${catalog.catalogId}`
			: null;

		logger.debug("Apple Music background", {
			trackName: state.trackName,
			catalogId: catalog?.catalogId ?? null,
			actionUrl,
			hasArtwork: !!catalog?.artworkUrl,
		});

		return {
			provider: "apple_music",
			kind: contentKind,
			id: state.parsed.id,
			title: state.trackName || null,
			subtitle: state.artistName || null,
			imageUrl: catalog?.artworkUrl ?? null,
			actionUrl,
		};
	},
};

export function getAppleMusicAutomationError(): string | null {
	return lastAutomationError;
}

export function getAppleMusicAutomationState(): AutomationState {
	return automationState;
}

export { APPLE_MUSIC_BUNDLE_IDS };
