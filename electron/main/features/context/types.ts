export interface ForegroundApp {
	name: string;
	bundleId: string;
	pid: number;
}

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ForegroundWindow {
	title: string;
	bounds: WindowBounds;
	displayId: string | null;
	isFullscreen: boolean;
}

export interface ForegroundSnapshot {
	app: ForegroundApp;
	window: ForegroundWindow;
	capturedAt: number;
}

export interface UrlMetadata {
	urlCanonical: string;
	host: string;
	title: string | null;
}

export type KnownContentKind =
	| "youtube_video"
	| "youtube_short"
	| "netflix_title"
	| "twitch_stream"
	| "twitch_vod"
	| "spotify_track"
	| "spotify_episode"
	| "apple_music_track"
	| "apple_music_episode"
	| "web_page"
	| "ide_workspace";

export type ContentKind = KnownContentKind | (string & {});

export interface ContentDescriptor {
	kind: ContentKind;
	id: string;
	title: string | null;
	urlCanonical: string;
	subtitle?: string | null;
	imageUrl?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ContextEnrichment {
	url: UrlMetadata | null;
	content: ContentDescriptor | null;
	confidence: number;
}

export interface BackgroundContext {
	provider: string;
	kind: ContentKind;
	id: string;
	title: string | null;
	subtitle: string | null;
	imageUrl: string | null;
	actionUrl: string | null;
}

export interface ActivityContext {
	capturedAt: number;
	app: ForegroundApp;
	window: ForegroundWindow;
	url: UrlMetadata | null;
	content: ContentDescriptor | null;
	provider: string;
	confidence: number;
	key: string;
	background: BackgroundContext[];
}
