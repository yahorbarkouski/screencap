import type { Event, GetEventsOptions } from "../../../shared/types";
import { getEvents } from "../../infra/db/repositories/EventRepository";
import { getRoomIdForProject } from "../../infra/db/repositories/ProjectRoomLinkRepository";
import type { CachedRoomEvent } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { listCachedRoomEventsByProject } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { getIdentity } from "../social/IdentityService";

function cachedEventToUnifiedEvent(cached: CachedRoomEvent): Event {
	return {
		id: cached.id,
		timestamp: cached.timestampMs,
		endTimestamp: cached.endTimestampMs,
		displayId: null,
		category: cached.category,
		subcategories: null,
		project: cached.project,
		projectProgress: cached.projectProgress,
		projectProgressConfidence: null,
		projectProgressEvidence: null,
		potentialProgress: 0,
		tags: null,
		confidence: null,
		caption: cached.caption,
		trackedAddiction: null,
		addictionCandidate: null,
		addictionConfidence: null,
		addictionPrompt: null,
		thumbnailPath: cached.thumbnailPath,
		originalPath: cached.originalPath,
		stableHash: null,
		detailHash: null,
		mergedCount: null,
		dismissed: 0,
		userLabel: null,
		status: "completed",
		appBundleId: cached.appBundleId,
		appName: cached.appName,
		appIconPath: null,
		windowTitle: cached.windowTitle,
		urlHost: null,
		urlCanonical: null,
		faviconPath: null,
		screenshotCount: null,
		contentKind: cached.contentKind,
		contentId: null,
		contentTitle: cached.contentTitle,
		isFullscreen: 0,
		contextProvider: null,
		contextConfidence: null,
		contextKey: null,
		contextJson: null,
		sharedToFriends: 0,
		authorUserId: cached.authorUserId,
		authorUsername: cached.authorUsername,
		isRemote: true,
	};
}

export interface GetUnifiedEventsOptions extends GetEventsOptions {
	includeRemote?: boolean;
}

export function getUnifiedEvents(options: GetUnifiedEventsOptions): Event[] {
	const localEvents = getEvents(options);

	const identity = getIdentity();
	if (!identity || options.includeRemote === false || !options.project) {
		return localEvents;
	}

	const roomId = getRoomIdForProject(options.project);
	if (!roomId) {
		return localEvents;
	}

	const remoteEvents = listCachedRoomEventsByProject({
		project: options.project,
		excludeAuthorId: identity.userId,
		startDate: options.startDate,
		endDate: options.endDate,
		limit: options.limit,
	});

	const unifiedRemoteEvents = remoteEvents.map(cachedEventToUnifiedEvent);
	const localEventIds = new Set(localEvents.map((e) => e.id));
	const filteredRemoteEvents = unifiedRemoteEvents.filter(
		(e) => !localEventIds.has(e.id),
	);

	const combined = [...localEvents, ...filteredRemoteEvents];
	combined.sort((a, b) => b.timestamp - a.timestamp);

	if (options.limit !== undefined) {
		return combined.slice(0, options.limit);
	}

	return combined;
}

export function hasLinkedRoom(project: string): boolean {
	const roomId = getRoomIdForProject(project);
	return roomId !== null;
}
