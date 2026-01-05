import type { DayWrappedSnapshot, SharedEvent } from "../../../shared/types";
import { getLatestCachedDayWrappedForAuthor } from "../../infra/db/repositories/RoomDayWrappedCacheRepository";
import type { CachedRoomEvent } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { listLatestCachedRoomEvents } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { listRoomMemberships } from "../../infra/db/repositories/RoomMembershipsRepository";
import { getIdentity } from "../social/IdentityService";
import { isFriendsFeedRoomName } from "./constants";

function cachedEventToSharedEvent(event: CachedRoomEvent): SharedEvent {
	let background: {
		provider: string;
		kind: string;
		id: string;
		title: string | null;
		subtitle: string | null;
		imageUrl: string | null;
		actionUrl: string | null;
	}[] = [];
	if (event.backgroundContext) {
		try {
			const parsed = JSON.parse(event.backgroundContext);
			if (Array.isArray(parsed)) background = parsed;
		} catch {
			// ignore parse errors
		}
	}

	return {
		id: event.id,
		roomId: event.roomId,
		authorUserId: event.authorUserId,
		authorUsername: event.authorUsername,
		timestampMs: event.timestampMs,
		endTimestampMs: event.endTimestampMs,
		project: event.project,
		category: event.category,
		caption: event.caption,
		projectProgress: event.projectProgress,
		appBundleId: event.appBundleId,
		appName: event.appName,
		windowTitle: event.windowTitle,
		contentKind: event.contentKind,
		contentTitle: event.contentTitle,
		thumbnailPath: event.thumbnailPath,
		originalPath: event.originalPath,
		imageRef: null, // imageRef is not stored in cache, images are downloaded locally
		url: event.url,
		background,
	};
}

export function getSocialFeedEvents(params?: {
	startDate?: number;
	endDate?: number;
	limit?: number;
	includeOwnEvents?: boolean;
}): SharedEvent[] {
	const identity = getIdentity();
	if (!identity) return [];

	const events = listLatestCachedRoomEvents({
		excludeAuthorId: params?.includeOwnEvents ? undefined : identity.userId,
		startDate: params?.startDate,
		endDate: params?.endDate,
		limit: params?.limit,
	});

	return events.map(cachedEventToSharedEvent);
}

function findFriendsFeedRoomIdForOwner(ownerUserId: string): string | null {
	const memberships = listRoomMemberships();
	const match = memberships.find(
		(m) => m.ownerUserId === ownerUserId && isFriendsFeedRoomName(m.roomName),
	);
	return match?.roomId ?? null;
}

export function getLatestFriendDayWrappedSnapshot(
	friendUserId: string,
): DayWrappedSnapshot | null {
	const roomId = findFriendsFeedRoomIdForOwner(friendUserId);
	if (!roomId) return null;

	const cached = getLatestCachedDayWrappedForAuthor({
		roomId,
		authorUserId: friendUserId,
	});
	if (!cached) return null;

	return {
		roomId,
		authorUserId: cached.authorUserId,
		authorUsername: cached.authorUsername,
		publishedAtMs: cached.timestampMs,
		dayStartMs: cached.dayStartMs,
		slots: cached.slots,
	};
}
