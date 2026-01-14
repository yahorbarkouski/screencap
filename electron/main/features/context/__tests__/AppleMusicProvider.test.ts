import { describe, expect, it } from "vitest";
import type { BackgroundContext } from "../types";

interface AppleMusicParsedId {
	type: "song" | "podcast_episode";
	id: string;
	persistentId: string;
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

function parseBackgroundFromContextJson(
	contextJson: string | null,
): BackgroundContext[] {
	if (!contextJson) return [];
	try {
		const parsed = JSON.parse(contextJson);
		if (Array.isArray(parsed?.background)) {
			return parsed.background;
		}
		return [];
	} catch {
		return [];
	}
}

describe("parseAppleMusicId", () => {
	it("parses valid database ID with persistent ID", () => {
		const result = parseAppleMusicId("12345", "ABCD1234EFGH5678");
		expect(result).toEqual({
			type: "song",
			id: "12345",
			persistentId: "ABCD1234EFGH5678",
		});
	});

	it("parses database ID without persistent ID", () => {
		const result = parseAppleMusicId("12345", "");
		expect(result).toEqual({
			type: "song",
			id: "12345",
			persistentId: "12345",
		});
	});

	it("returns null for empty database ID", () => {
		expect(parseAppleMusicId("", "ABC123")).toBeNull();
	});

	it("returns null for zero database ID", () => {
		expect(parseAppleMusicId("0", "ABC123")).toBeNull();
	});
});

describe("parseBackgroundFromContextJson with Apple Music", () => {
	it("returns empty array for null contextJson", () => {
		expect(parseBackgroundFromContextJson(null)).toEqual([]);
	});

	it("returns empty array for invalid JSON", () => {
		expect(parseBackgroundFromContextJson("not json")).toEqual([]);
	});

	it("returns empty array when background field is missing", () => {
		const json = JSON.stringify({ app: "test", content: null });
		expect(parseBackgroundFromContextJson(json)).toEqual([]);
	});

	it("extracts Apple Music background from contextJson", () => {
		const background: BackgroundContext[] = [
			{
				provider: "apple_music",
				kind: "apple_music_track",
				id: "12345",
				title: "Bohemian Rhapsody",
				subtitle: "Queen",
				imageUrl: null,
				actionUrl: "itms://music.apple.com/song/12345",
			},
		];
		const json = JSON.stringify({
			app: { bundleId: "com.google.Chrome" },
			background,
		});

		const result = parseBackgroundFromContextJson(json);
		expect(result).toHaveLength(1);
		expect(result[0].provider).toBe("apple_music");
		expect(result[0].kind).toBe("apple_music_track");
		expect(result[0].title).toBe("Bohemian Rhapsody");
		expect(result[0].subtitle).toBe("Queen");
		expect(result[0].actionUrl).toBe("itms://music.apple.com/song/12345");
	});

	it("handles mixed Spotify and Apple Music background items", () => {
		const background: BackgroundContext[] = [
			{
				provider: "spotify",
				kind: "spotify_track",
				id: "track1",
				title: "Spotify Track",
				subtitle: "Spotify Artist",
				imageUrl: "https://i.scdn.co/image/abc123",
				actionUrl: "spotify:track:track1",
			},
			{
				provider: "apple_music",
				kind: "apple_music_track",
				id: "12345",
				title: "Apple Music Track",
				subtitle: "Apple Music Artist",
				imageUrl: null,
				actionUrl: "itms://music.apple.com/song/12345",
			},
		];
		const json = JSON.stringify({ background });

		const result = parseBackgroundFromContextJson(json);
		expect(result).toHaveLength(2);
		expect(result[0].provider).toBe("spotify");
		expect(result[1].provider).toBe("apple_music");
	});
});
