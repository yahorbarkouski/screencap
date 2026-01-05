import type { Event } from "../../../../shared/types";
import { isFriendsFeedRoomName } from "../constants";
import {
	applyDayWrappedVisibility,
	buildDayWrappedRoomEventId,
	computeDayWrappedSlots,
	DAY_WRAPPED_SLOTS_PER_DAY,
} from "../dayWrapped";
import {
	DAY_WRAPPED_PAYLOAD_KIND,
	DAY_WRAPPED_PAYLOAD_VERSION,
	encodeDayWrappedRoomPayload,
	parseDayWrappedRoomPayload,
} from "../dayWrappedPayload";

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

describe("socialFeed day wrapped", () => {
	it("detects friends feed room name", () => {
		expect(isFriendsFeedRoomName("Friends Feed")).toBe(true);
		expect(isFriendsFeedRoomName(" friends feed ")).toBe(true);
		expect(isFriendsFeedRoomName("FRIENDS FEED")).toBe(true);
		expect(isFriendsFeedRoomName("Friends")).toBe(false);
	});

	it("computes deterministic day wrapped slots", () => {
		const dayStartMs = 1_700_000_000_000;
		const slotMs = 10 * 60 * 1000;
		const events: Event[] = [
			makeEvent({
				id: "a",
				timestamp: dayStartMs + 1 * 60 * 1000,
				category: "Work",
				appName: "VS Code",
			}),
			makeEvent({
				id: "b",
				timestamp: dayStartMs + 2 * 60 * 1000,
				category: "Work",
				appName: "VS Code",
				trackedAddiction: "YouTube",
			}),
			makeEvent({
				id: "c",
				timestamp: dayStartMs + slotMs + 1,
				category: "Study",
				appName: "Arc",
			}),
		];

		const slots = computeDayWrappedSlots(events, dayStartMs);
		expect(slots).toHaveLength(DAY_WRAPPED_SLOTS_PER_DAY);
		expect(slots[0]?.startMs).toBe(dayStartMs);
		expect(slots[1]?.startMs).toBe(dayStartMs + slotMs);
		expect(slots[0]?.count).toBe(2);
		expect(slots[0]?.category).toBe("Work");
		expect(slots[0]?.appName).toBe("VS Code");
		expect(slots[0]?.addiction).toBe("YouTube");
		expect(slots[1]?.count).toBe(1);
		expect(slots[1]?.category).toBe("Study");
	});

	it("applies visibility flags without mutating original", () => {
		const dayStartMs = 1_700_000_000_000;
		const slots = computeDayWrappedSlots(
			[
				makeEvent({
					timestamp: dayStartMs + 1,
					category: "Work",
					appName: "VS Code",
					addictionCandidate: "TikTok",
				}),
			],
			dayStartMs,
		);

		const hidden = applyDayWrappedVisibility(slots, {
			includeApps: false,
			includeAddiction: false,
		});

		expect(hidden).not.toBe(slots);
		expect(hidden[0]?.appName).toBeNull();
		expect(hidden[0]?.addiction).toBeNull();

		const full = applyDayWrappedVisibility(slots, {
			includeApps: true,
			includeAddiction: true,
		});
		expect(full).toBe(slots);
	});

	it("builds a stable day wrapped event id", () => {
		const id1 = buildDayWrappedRoomEventId({
			authorUserId: "user_123",
			dayStartMs: 1_700_000_000_000,
		});
		const id2 = buildDayWrappedRoomEventId({
			authorUserId: "user_123",
			dayStartMs: 1_700_000_000_000,
		});
		expect(id1).toBe(id2);
		expect(id1.startsWith("dw_")).toBe(true);
		expect(id1.length).toBeLessThanOrEqual(128);
	});

	it("encodes and parses day wrapped payload", () => {
		const dayStartMs = 1_700_000_000_000;
		const slots = Array.from({ length: DAY_WRAPPED_SLOTS_PER_DAY }, (_, i) => ({
			startMs: dayStartMs + i * 10 * 60 * 1000,
			count: i === 0 ? 2 : 0,
			category: "Work" as const,
			addiction: i === 0 ? "x".repeat(1000) : null,
			appName: null,
		}));

		const payload = {
			kind: DAY_WRAPPED_PAYLOAD_KIND,
			v: DAY_WRAPPED_PAYLOAD_VERSION,
			dayStartMs,
			slots,
		};

		const bytes = encodeDayWrappedRoomPayload(payload);
		const parsed = parseDayWrappedRoomPayload(
			JSON.parse(Buffer.from(bytes).toString("utf8")),
		);
		expect(parsed?.kind).toBe(DAY_WRAPPED_PAYLOAD_KIND);
		expect(parsed?.v).toBe(DAY_WRAPPED_PAYLOAD_VERSION);
		expect(parsed?.dayStartMs).toBe(dayStartMs);
		expect(parsed?.slots).toHaveLength(DAY_WRAPPED_SLOTS_PER_DAY);
		expect(parsed?.slots[0]?.addiction?.length).toBe(200);
	});

	it("rejects invalid day wrapped payload", () => {
		const parsed = parseDayWrappedRoomPayload({
			kind: DAY_WRAPPED_PAYLOAD_KIND,
			v: DAY_WRAPPED_PAYLOAD_VERSION,
			dayStartMs: 1,
			slots: [{ startMs: 1, count: 0, category: "NotARealCategory" }],
		});
		expect(parsed).toBeNull();
	});
});
