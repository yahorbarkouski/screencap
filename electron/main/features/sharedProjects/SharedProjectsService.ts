import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CachedRoomEvent,
	getLatestCachedEventTimestamp,
	listCachedRoomEvents,
	listCachedRoomEventsByProject,
	upsertCachedRoomEventsBatch,
	updateCachedEventImagePath,
} from "../../infra/db/repositories/RoomEventsCacheRepository";
import {
	type RoomMembership,
	listRoomMemberships,
	updateRoomMembershipLastSynced,
	getRoomMembership,
} from "../../infra/db/repositories/RoomMembershipsRepository";
import {
	upsertRoomMembersBatch,
} from "../../infra/db/repositories/RoomMembersCacheRepository";
import { createLogger } from "../../infra/log";
import { getSharedRoomImagesDir } from "../../infra/paths";
import { decryptRoomImageBytes } from "../rooms/RoomCrypto";
import { getRoomKey } from "../rooms/RoomsService";
import { getIdentity, signedFetch } from "../social/IdentityService";
import { fetchRoomEvents } from "../sync/RoomSyncService";
import { SOCIAL_API_BASE_URL } from "../social/config";

const logger = createLogger({ scope: "SharedProjectsService" });

export type SharedProject = {
	roomId: string;
	projectName: string;
	ownerUserId: string;
	ownerUsername: string;
	isOwner: boolean;
	joinedAt: number;
	lastSyncedAt: number | null;
};

export type SharedEvent = {
	id: string;
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	timestampMs: number;
	endTimestampMs: number | null;
	project: string | null;
	category: string | null;
	caption: string | null;
	projectProgress: number;
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
	contentKind: string | null;
	contentTitle: string | null;
	thumbnailPath: string | null;
	originalPath: string | null;
};

function membershipToSharedProject(
	membership: RoomMembership,
): SharedProject {
	return {
		roomId: membership.roomId,
		projectName: membership.roomName,
		ownerUserId: membership.ownerUserId,
		ownerUsername: membership.ownerUsername,
		isOwner: membership.role === "owner",
		joinedAt: membership.joinedAt,
		lastSyncedAt: membership.lastSyncedAt,
	};
}

function cachedEventToSharedEvent(event: CachedRoomEvent): SharedEvent {
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
	};
}

export function listSharedProjects(): SharedProject[] {
	const identity = getIdentity();
	if (!identity) return [];

	const memberships = listRoomMemberships();
	return memberships.map((m) => membershipToSharedProject(m));
}

export function getSharedProjectEvents(params: {
	roomId: string;
	startDate?: number;
	endDate?: number;
	limit?: number;
}): SharedEvent[] {
	const identity = getIdentity();
	if (!identity) return [];

	const events = listCachedRoomEvents({
		roomId: params.roomId,
		excludeAuthorId: identity.userId,
		startDate: params.startDate,
		endDate: params.endDate,
		limit: params.limit,
	});

	return events.map(cachedEventToSharedEvent);
}

export function getSharedProjectEventsByProjectName(params: {
	project: string;
	startDate?: number;
	endDate?: number;
	limit?: number;
}): SharedEvent[] {
	const identity = getIdentity();
	if (!identity) return [];

	const events = listCachedRoomEventsByProject({
		project: params.project,
		excludeAuthorId: identity.userId,
		startDate: params.startDate,
		endDate: params.endDate,
		limit: params.limit,
	});

	return events.map(cachedEventToSharedEvent);
}

export async function syncRoom(roomId: string, backfill = false): Promise<{ count: number }> {
	const identity = getIdentity();
	if (!identity) {
		throw new Error("Not authenticated");
	}

	const since = backfill ? undefined : (getLatestCachedEventTimestamp(roomId) ?? undefined);
	const events = await fetchRoomEvents({
		roomId,
		since,
	});

	if (events.length === 0) {
		updateRoomMembershipLastSynced(roomId, Date.now());
		return { count: 0 };
	}

	const roomMembers = await fetchRoomMembers(roomId);
	if (roomMembers.length > 0) {
		upsertRoomMembersBatch(
			roomMembers.map((m) => ({
				roomId,
				userId: m.userId,
				username: m.username,
				role: m.role,
			})),
		);
	}

	const usernameMap = new Map<string, string>();
	for (const m of roomMembers) {
		usernameMap.set(m.userId, m.username);
	}

	const membership = getRoomMembership(roomId);
	const projectName = membership?.roomName ?? null;

	const now = Date.now();
	const cachedEvents: CachedRoomEvent[] = events.map((e) => ({
		id: e.id,
		roomId: e.roomId,
		authorUserId: e.authorUserId,
		authorUsername: usernameMap.get(e.authorUserId) ?? "Unknown",
		timestampMs: e.timestampMs,
		endTimestampMs: e.endTimestampMs,
		project: e.project ?? projectName,
		category: e.category,
		caption: e.caption,
		projectProgress: e.projectProgress,
		appBundleId: e.appBundleId,
		appName: e.appName,
		windowTitle: e.windowTitle,
		contentKind: e.contentKind,
		contentTitle: e.contentTitle,
		thumbnailPath: null,
		originalPath: null,
		syncedAt: now,
	}));

	upsertCachedRoomEventsBatch(cachedEvents);

	const eventsWithImages = events.filter(
		(e) => e.imageRef && e.authorUserId !== identity.userId,
	);
	await downloadAndCacheImages(roomId, eventsWithImages);

	updateRoomMembershipLastSynced(roomId, now);

	logger.info("Synced room", { roomId, count: events.length, backfill });
	return { count: events.length };
}

export async function syncRoomWithBackfill(roomId: string): Promise<{ count: number }> {
	return syncRoom(roomId, true);
}

export async function syncAllRooms(): Promise<void> {
	const projects = listSharedProjects();

	for (const project of projects) {
		try {
			await syncRoom(project.roomId);
		} catch (error) {
			logger.warn("Failed to sync room", {
				roomId: project.roomId,
				error: String(error),
			});
		}
	}

	logger.info("Synced all rooms", { count: projects.length });
}

async function fetchRoomMembers(
	roomId: string,
): Promise<Array<{ userId: string; username: string; role: string }>> {
	try {
		const res = await signedFetch(`/api/rooms/${roomId}/members`, {
			method: "GET",
		});
		if (!res.ok) {
			logger.warn("Failed to fetch room members", {
				roomId,
				status: res.status,
			});
			return [];
		}
		return (await res.json()) as Array<{
			userId: string;
			username: string;
			role: string;
		}>;
	} catch (error) {
		logger.warn("Error fetching room members", { roomId, error: String(error) });
		return [];
	}
}

async function downloadAndCacheImages(
	roomId: string,
	events: Array<{
		id: string;
		imageRef: string | null;
	}>,
): Promise<void> {
	const roomKey = await getRoomKey(roomId);
	const imagesDir = getSharedRoomImagesDir(roomId);

	for (const event of events) {
		if (!event.imageRef) continue;

		const thumbnailPath = join(imagesDir, `${event.id}.webp`);
		const originalPath = join(imagesDir, `${event.id}.png`);

		if (existsSync(originalPath)) {
			updateCachedEventImagePath(event.id, thumbnailPath, originalPath);
			continue;
		}

		try {
			const imageUrl = event.imageRef.startsWith("http")
				? event.imageRef
				: `${SOCIAL_API_BASE_URL}${event.imageRef}`;

			const res = await fetch(imageUrl);
			if (!res.ok) {
				logger.warn("Failed to download image", {
					eventId: event.id,
					status: res.status,
				});
				continue;
			}

			const encryptedBytes = new Uint8Array(await res.arrayBuffer());
			const decryptedBytes = decryptRoomImageBytes({
				roomKey,
				ciphertextBytes: encryptedBytes,
			});

			writeFileSync(originalPath, decryptedBytes);
			updateCachedEventImagePath(event.id, originalPath, originalPath);

			logger.debug("Cached image", { eventId: event.id, path: originalPath });
		} catch (error) {
			logger.warn("Error downloading/decrypting image", {
				eventId: event.id,
				error: String(error),
			});
		}
	}
}
