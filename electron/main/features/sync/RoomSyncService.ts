import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { getEventById } from "../../infra/db/repositories/EventRepository";
import { getRoomIdForProject } from "../../infra/db/repositories/ProjectRoomLinkRepository";
import { createLogger } from "../../infra/log";
import { getSettings } from "../../infra/settings/SettingsStore";
import {
	decryptRoomEventPayload,
	encryptRoomEventPayload,
	encryptRoomImageBytes,
} from "../rooms/RoomCrypto";
import { getRoomKey } from "../rooms/RoomsService";
import { signedFetch } from "../social/IdentityService";

const logger = createLogger({ scope: "RoomSyncService" });

const MAX_FILE_SIZE_BYTES = 45 * 1024 * 1024;
const PAYLOAD_VERSION = 2;

function mimeTypeForPath(path: string): string {
	const ext = extname(path).slice(1).toLowerCase();
	if (ext === "png") return "image/png";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	return "image/webp";
}

function getUploadablePath(originalPath: string | null): string | null {
	if (!originalPath) return null;
	if (!existsSync(originalPath)) return null;
	try {
		const bytes = readFileSync(originalPath);
		if (bytes.byteLength > MAX_FILE_SIZE_BYTES) return null;
		return originalPath;
	} catch {
		return null;
	}
}

export interface SharedEventPayload {
	v: number;
	timestamp: number;
	endTimestamp: number | null;
	project: string | null;
	category: string | null;
	caption: string | null;
	projectProgress: number;
	appBundleId?: string | null;
	appName?: string | null;
	windowTitle?: string | null;
	contentKind?: string | null;
	contentTitle?: string | null;
	image: { ref: string | null; mime: string };
}

function buildPayloadJson(params: {
	timestamp: number;
	endTimestamp: number | null;
	project: string | null;
	category: string | null;
	caption: string | null;
	projectProgress: number;
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
	contentKind: string | null;
	contentTitle: string | null;
	imageRef: string | null;
	mime: string;
}): Uint8Array {
	const settings = getSettings();
	const sharing = settings.sharing;

	const payload: SharedEventPayload = {
		v: PAYLOAD_VERSION,
		timestamp: params.timestamp,
		endTimestamp: params.endTimestamp,
		project: params.project,
		category: params.category,
		caption: params.caption,
		projectProgress: params.projectProgress,
		image: { ref: params.imageRef, mime: params.mime },
	};

	if (sharing.includeAppName) {
		payload.appBundleId = params.appBundleId;
		payload.appName = params.appName;
	}

	if (sharing.includeWindowTitle) {
		payload.windowTitle = params.windowTitle;
	}

	if (sharing.includeContentInfo) {
		payload.contentKind = params.contentKind;
		payload.contentTitle = params.contentTitle;
	}

	return Buffer.from(JSON.stringify(payload), "utf8");
}

export async function publishProgressEventToRoom(
	eventId: string,
): Promise<void> {
	const event = getEventById(eventId);
	if (!event) return;
	if (!event.project) return;

	const roomId = getRoomIdForProject(event.project);
	if (!roomId) return;

	const roomKey = await getRoomKey(roomId);

	const imagePath = getUploadablePath(event.originalPath);
	if (!imagePath) {
		logger.warn("Event image missing or too large", { eventId });
		return;
	}
	const mime = mimeTypeForPath(imagePath);

	const payload0 = encryptRoomEventPayload({
		roomKey,
		payloadJsonUtf8: buildPayloadJson({
			timestamp: event.timestamp,
			endTimestamp: event.endTimestamp,
			project: event.project,
			category: event.category,
			caption: event.caption,
			projectProgress: event.projectProgress,
			appBundleId: event.appBundleId,
			appName: event.appName,
			windowTitle: event.windowTitle,
			contentKind: event.contentKind,
			contentTitle: event.contentTitle,
			imageRef: null,
			mime,
		}),
	});

	const createRes = await signedFetch(`/api/rooms/${roomId}/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId,
			timestampMs: event.timestamp,
			payloadCiphertext: payload0,
		}),
	});

	if (!createRes.ok) {
		const text = await createRes.text();
		throw new Error(`room event create failed: ${createRes.status} ${text}`);
	}

	const plaintextImage = readFileSync(imagePath);
	const encryptedImage = encryptRoomImageBytes({
		roomKey,
		plaintextBytes: plaintextImage,
	});

	const imageRes = await signedFetch(
		`/api/rooms/${roomId}/events/${eventId}/image`,
		{
			method: "POST",
			headers: { "Content-Type": "application/octet-stream" },
			body: encryptedImage,
		},
	);

	if (!imageRes.ok) {
		const text = await imageRes.text();
		throw new Error(`room image upload failed: ${imageRes.status} ${text}`);
	}

	const { imageRef } = (await imageRes.json()) as { imageRef: string };
	const payload1 = encryptRoomEventPayload({
		roomKey,
		payloadJsonUtf8: buildPayloadJson({
			timestamp: event.timestamp,
			endTimestamp: event.endTimestamp,
			project: event.project,
			category: event.category,
			caption: event.caption,
			projectProgress: event.projectProgress,
			appBundleId: event.appBundleId,
			appName: event.appName,
			windowTitle: event.windowTitle,
			contentKind: event.contentKind,
			contentTitle: event.contentTitle,
			imageRef,
			mime,
		}),
	});

	const updateRes = await signedFetch(`/api/rooms/${roomId}/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId,
			timestampMs: event.timestamp,
			payloadCiphertext: payload1,
		}),
	});

	if (!updateRes.ok) {
		const text = await updateRes.text();
		throw new Error(`room event update failed: ${updateRes.status} ${text}`);
	}

	logger.info("Published room event", { eventId, roomId });
}

export type DecryptedRoomEvent = {
	id: string;
	roomId: string;
	authorUserId: string;
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
	imageRef: string | null;
};

function parsePayloadV1(payload: {
	caption?: string | null;
	image?: { ref?: string | null };
}): Omit<DecryptedRoomEvent, "id" | "roomId" | "authorUserId" | "timestampMs"> {
	return {
		endTimestampMs: null,
		project: null,
		category: null,
		caption: typeof payload?.caption === "string" ? payload.caption : null,
		projectProgress: 1,
		appBundleId: null,
		appName: null,
		windowTitle: null,
		contentKind: null,
		contentTitle: null,
		imageRef: typeof payload?.image?.ref === "string" ? payload.image.ref : null,
	};
}

function parsePayloadV2(payload: SharedEventPayload): Omit<DecryptedRoomEvent, "id" | "roomId" | "authorUserId" | "timestampMs"> {
	return {
		endTimestampMs: payload.endTimestamp ?? null,
		project: payload.project ?? null,
		category: payload.category ?? null,
		caption: payload.caption ?? null,
		projectProgress: payload.projectProgress ?? 1,
		appBundleId: payload.appBundleId ?? null,
		appName: payload.appName ?? null,
		windowTitle: payload.windowTitle ?? null,
		contentKind: payload.contentKind ?? null,
		contentTitle: payload.contentTitle ?? null,
		imageRef: payload.image?.ref ?? null,
	};
}

export async function fetchRoomEvents(params: {
	roomId: string;
	since?: number;
	before?: number;
	limit?: number;
}): Promise<DecryptedRoomEvent[]> {
	const roomKey = await getRoomKey(params.roomId);

	const qp = new URLSearchParams();
	if (params.since !== undefined) qp.set("since", String(params.since));
	if (params.before !== undefined) qp.set("before", String(params.before));
	if (params.limit !== undefined) qp.set("limit", String(params.limit));

	const url =
		qp.size > 0
			? `/api/rooms/${params.roomId}/events?${qp}`
			: `/api/rooms/${params.roomId}/events`;
	const res = await signedFetch(url, { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`fetchRoomEvents failed: ${res.status} ${text}`);
	}

	const events = (await res.json()) as Array<{
		id: string;
		roomId: string;
		authorUserId: string;
		timestampMs: number;
		payloadCiphertext: string;
		imageRef: string | null;
	}>;

	return events.map((e) => {
		const payloadBytes = decryptRoomEventPayload({
			roomKey,
			payloadCiphertextB64: e.payloadCiphertext,
		});
		const payload = JSON.parse(payloadBytes.toString("utf8")) as SharedEventPayload & {
			v?: number;
			caption?: string | null;
			image?: { ref?: string | null };
		};

		const isV2 = payload.v === PAYLOAD_VERSION;
		const parsed = isV2 ? parsePayloadV2(payload) : parsePayloadV1(payload);

		const imageRef = parsed.imageRef ?? e.imageRef ?? null;

		return {
			id: e.id,
			roomId: e.roomId,
			authorUserId: e.authorUserId,
			timestampMs: e.timestampMs,
			endTimestampMs: parsed.endTimestampMs,
			project: parsed.project,
			category: parsed.category,
			caption: parsed.caption,
			projectProgress: parsed.projectProgress,
			appBundleId: parsed.appBundleId,
			appName: parsed.appName,
			windowTitle: parsed.windowTitle,
			contentKind: parsed.contentKind,
			contentTitle: parsed.contentTitle,
			imageRef,
		};
	});
}
