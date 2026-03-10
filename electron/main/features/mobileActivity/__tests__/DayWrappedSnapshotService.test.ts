import type { Event, MobileActivityDay } from "../../../../shared/types";
import { computeCombinedWrappedSlots } from "../DayWrappedSnapshotService";

function makeEvent(overrides: Partial<Event>): Event {
	return {
		id: overrides.id ?? "e",
		timestamp: overrides.timestamp ?? Date.now(),
		endTimestamp: overrides.endTimestamp ?? null,
		displayId: overrides.displayId ?? null,
		category: overrides.category ?? null,
		subcategories: overrides.subcategories ?? null,
		project: overrides.project ?? null,
		projectProgress: overrides.projectProgress ?? 0,
		projectProgressConfidence: overrides.projectProgressConfidence ?? null,
		projectProgressEvidence: overrides.projectProgressEvidence ?? null,
		potentialProgress: overrides.potentialProgress ?? 0,
		tags: overrides.tags ?? null,
		confidence: overrides.confidence ?? null,
		caption: overrides.caption ?? null,
		trackedAddiction: overrides.trackedAddiction ?? null,
		addictionCandidate: overrides.addictionCandidate ?? null,
		addictionConfidence: overrides.addictionConfidence ?? null,
		addictionPrompt: overrides.addictionPrompt ?? null,
		thumbnailPath: overrides.thumbnailPath ?? null,
		originalPath: overrides.originalPath ?? null,
		stableHash: overrides.stableHash ?? null,
		detailHash: overrides.detailHash ?? null,
		mergedCount: overrides.mergedCount ?? null,
		dismissed: overrides.dismissed ?? 0,
		userLabel: overrides.userLabel ?? null,
		status: overrides.status ?? "completed",
		appBundleId: overrides.appBundleId ?? null,
		appName: overrides.appName ?? null,
		appIconPath: overrides.appIconPath ?? null,
		windowTitle: overrides.windowTitle ?? null,
		urlHost: overrides.urlHost ?? null,
		urlCanonical: overrides.urlCanonical ?? null,
		faviconPath: overrides.faviconPath ?? null,
		screenshotCount: overrides.screenshotCount ?? null,
		contentKind: overrides.contentKind ?? null,
		contentId: overrides.contentId ?? null,
		contentTitle: overrides.contentTitle ?? null,
		isFullscreen: overrides.isFullscreen ?? 0,
		contextProvider: overrides.contextProvider ?? null,
		contextConfidence: overrides.contextConfidence ?? null,
		contextKey: overrides.contextKey ?? null,
		contextJson: overrides.contextJson ?? null,
		sharedToFriends: overrides.sharedToFriends ?? 0,
	};
}

function makeMobileDay(
	overrides: Partial<MobileActivityDay>,
): MobileActivityDay {
	return {
		deviceId: overrides.deviceId ?? "ios-1",
		deviceName: overrides.deviceName ?? "iPhone",
		platform: overrides.platform ?? "ios",
		dayStartMs: overrides.dayStartMs ?? 0,
		buckets: overrides.buckets ?? [],
		syncedAt: overrides.syncedAt ?? Date.now(),
	};
}

describe("DayWrappedSnapshotService", () => {
	it("merges Mac and iPhone slots into one combined dayline", () => {
		const dayStartMs = 1_700_000_000_000;
		const slotMs = 10 * 60 * 1000;
		const slots = computeCombinedWrappedSlots(
			[
				makeEvent({
					id: "mac-1",
					timestamp: dayStartMs + slotMs,
					category: "Work",
					appName: "VS Code",
				}),
				makeEvent({
					id: "mac-2",
					timestamp: dayStartMs + slotMs,
					category: "Work",
					appName: "VS Code",
				}),
			],
			[
				makeMobileDay({
					dayStartMs,
					buckets: [
						{
							hour: 0,
							durationSeconds: 3_500,
							category: "Leisure",
							appName: "YouTube",
						},
					],
				}),
			],
			dayStartMs,
			false,
		);

		expect(slots[0]?.source).toBe("iphone");
		expect(slots[0]?.category).toBe("Leisure");
		expect(slots[0]?.count).toBe(4);
		expect(slots[0]?.macCount).toBe(0);
		expect(slots[0]?.iphoneCount).toBe(4);

		expect(slots[1]?.source).toBe("both");
		expect(slots[1]?.category).toBe("Leisure");
		expect(slots[1]?.appName).toBe("YouTube");
		expect(slots[1]?.count).toBe(4);
		expect(slots[1]?.macCount).toBe(2);
		expect(slots[1]?.iphoneCount).toBe(4);
	});

	it("prefers dominant websites for browser slots when the setting is enabled", () => {
		const dayStartMs = 1_700_000_000_000;
		const slots = computeCombinedWrappedSlots(
			[
				makeEvent({
					id: "browser-1",
					timestamp: dayStartMs + 1,
					category: "Study",
					appName: "Safari",
					urlHost: "docs.swift.org",
				}),
				makeEvent({
					id: "browser-2",
					timestamp: dayStartMs + 2,
					category: "Study",
					appName: "Safari",
					urlHost: "docs.swift.org",
				}),
				makeEvent({
					id: "browser-3",
					timestamp: dayStartMs + 3,
					category: "Study",
					appName: "Safari",
					urlHost: "apple.com",
				}),
			],
			[],
			dayStartMs,
			true,
		);

		expect(slots[0]?.appName).toBe("docs.swift.org");
		expect(slots[0]?.source).toBe("mac");
	});
});
