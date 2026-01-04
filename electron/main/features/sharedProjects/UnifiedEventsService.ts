import type { Event } from "../../../shared/types";
import type { CachedRoomEvent } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { listCachedRoomEventsByProject } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { getRoomIdForProject } from "../../infra/db/repositories/ProjectRoomLinkRepository";
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
		authorUserId: cached.authorUserId,
		authorUsername: cached.authorUsername,
		isRemote: true,
	};
}

export interface GetUnifiedProjectEventsParams {
	project: string;
	startDate?: number;
	endDate?: number;
	limit?: number;
	includeRemote?: boolean;
}

export function getUnifiedProjectEvents(
	localEvents: Event[],
	params: GetUnifiedProjectEventsParams,
): Event[] {
	const identity = getIdentity();
	if (!identity || params.includeRemote === false) {
		return localEvents;
	}

	const roomId = getRoomIdForProject(params.project);
	if (!roomId) {
		return localEvents;
	}

	const remoteEvents = listCachedRoomEventsByProject({
		project: params.project,
		excludeAuthorId: identity.userId,
		startDate: params.startDate,
		endDate: params.endDate,
		limit: params.limit,
	});

	const unifiedRemoteEvents = remoteEvents.map(cachedEventToUnifiedEvent);

	const localEventIds = new Set(localEvents.map((e) => e.id));
	const filteredRemoteEvents = unifiedRemoteEvents.filter(
		(e) => !localEventIds.has(e.id),
	);

	const combined = [...localEvents, ...filteredRemoteEvents];
	combined.sort((a, b) => b.timestamp - a.timestamp);

	if (params.limit !== undefined) {
		return combined.slice(0, params.limit);
	}

	return combined;
}

export function hasLinkedRoom(project: string): boolean {
	const roomId = getRoomIdForProject(project);
	return roomId !== null;
}
