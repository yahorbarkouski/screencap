import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BackgroundContext } from "../../../shared/types";
import { getEventById } from "../../infra/db/repositories/EventRepository";
import {
	type CachedDayWrapped,
	upsertCachedDayWrappedBatch,
} from "../../infra/db/repositories/RoomDayWrappedCacheRepository";
import {
	type CachedRoomEvent,
	getLatestCachedEventTimestamp,
	listCachedRoomEvents,
	listCachedRoomEventsByProject,
	updateCachedEventImagePath,
	upsertCachedRoomEventsBatch,
} from "../../infra/db/repositories/RoomEventsCacheRepository";
import { upsertRoomMembersBatch } from "../../infra/db/repositories/RoomMembersCacheRepository";
import {
	getRoomMembership,
	listRoomMemberships,
	type RoomMembership,
	updateRoomMembershipLastSynced,
} from "../../infra/db/repositories/RoomMembershipsRepository";
import { createLogger } from "../../infra/log";
import { getSharedRoomImagesDir } from "../../infra/paths";
import { decryptRoomImageBytes } from "../rooms/RoomCrypto";
import { getRoomKey } from "../rooms/RoomsService";
import { getSocialApiBaseUrl } from "../social/config";
import { getIdentity, signedFetch } from "../social/IdentityService";
import { fetchRoomEvents } from "../sync/RoomSyncService";

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
	url: string | null;
	background: BackgroundContext[];
	imageRef: string | null;
	thumbnailPath: string | null;
	originalPath: string | null;
};

function membershipToSharedProject(membership: RoomMembership): SharedProject {
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
		url: event.url,
		background: event.backgroundContext
			? JSON.parse(event.backgroundContext)
			: [],
		imageRef: null,
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

export async function syncRoom(
	roomId: string,
	backfill = false,
): Promise<{ count: number }> {
	const identity = getIdentity();
	if (!identity) {
		throw new Error("Not authenticated");
	}

	const latestEventTs = getLatestCachedEventTimestamp(roomId) ?? 0;
	const hasEvents = latestEventTs > 0;
	const since = backfill || !hasEvents ? undefined : latestEventTs;
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
	const cachedEvents: CachedRoomEvent[] = [];
	const cachedDayWrapped: CachedDayWrapped[] = [];

	for (const e of events) {
		const authorUsername = usernameMap.get(e.authorUserId) ?? "Unknown";

		if (e.kind === "day_wrapped") {
			if (!e.dayStartMs || !e.slots) continue;
			cachedDayWrapped.push({
				id: e.id,
				roomId: e.roomId,
				authorUserId: e.authorUserId,
				authorUsername,
				timestampMs: e.timestampMs,
				dayStartMs: e.dayStartMs,
				slots: e.slots,
				syncedAt: now,
			});
			continue;
		}

		// For own events, get local image paths from the database
		let thumbnailPath: string | null = null;
		let originalPath: string | null = null;
		if (e.authorUserId === identity.userId) {
			const localEvent = getEventById(e.id);
			if (localEvent) {
				thumbnailPath = localEvent.thumbnailPath;
				originalPath = localEvent.originalPath;
			}
		}

		cachedEvents.push({
			id: e.id,
			roomId: e.roomId,
			authorUserId: e.authorUserId,
			authorUsername,
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
			url: e.url ?? null,
			backgroundContext:
				e.background && e.background.length > 0
					? JSON.stringify(e.background)
					: null,
			thumbnailPath,
			originalPath,
			syncedAt: now,
		});
	}

	upsertCachedRoomEventsBatch(cachedEvents);
	upsertCachedDayWrappedBatch(cachedDayWrapped);

	const eventsWithImages = events.filter(
		(e) =>
			e.kind === "shared_event" &&
			e.imageRef &&
			e.authorUserId !== identity.userId,
	);
	await downloadAndCacheImages(roomId, eventsWithImages);

	updateRoomMembershipLastSynced(roomId, now);

	logger.info("Synced room", { roomId, count: events.length, backfill });
	return { count: events.length };
}

export async function syncRoomWithBackfill(
	roomId: string,
): Promise<{ count: number }> {
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
		logger.warn("Error fetching room members", {
			roomId,
			error: String(error),
		});
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
			const baseUrl = getSocialApiBaseUrl();
			const imageUrl = event.imageRef.startsWith("http")
				? event.imageRef
				: `${baseUrl}${event.imageRef}`;

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
