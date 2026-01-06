import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import {
	type BackgroundContext,
	type DayWrappedSlot,
	parseBackgroundFromEvent,
} from "../../../shared/types";
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
import { SOCIAL_API_BASE_URL } from "../social/config";
import { signedFetch } from "../social/IdentityService";
import { parseDayWrappedRoomPayload } from "../socialFeed/dayWrappedPayload";

const logger = createLogger({ scope: "RoomSyncService" });

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

async function uploadImageToBlob(params: {
	roomId: string;
	eventId: string;
	encryptedImage: Buffer;
}): Promise<string> {
	const pathname = `rooms/${params.roomId}/images/${params.eventId}.bin`;

	const tokenRes = await signedFetch(
		`/api/rooms/${params.roomId}/events/${params.eventId}/image/upload`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "blob.generate-client-token",
				payload: {
					pathname,
					callbackUrl: `${SOCIAL_API_BASE_URL}/api/rooms/${params.roomId}/events/${params.eventId}/image/upload`,
				},
			}),
		},
	);

	if (!tokenRes.ok) {
		const text = await tokenRes.text();
		throw new Error(`blob token request failed: ${tokenRes.status} ${text}`);
	}

	const tokenData = (await tokenRes.json()) as {
		type: string;
		clientToken: string;
		uploadUrl: string;
	};

	if (tokenData.type !== "blob.upload-token") {
		throw new Error(`unexpected token response type: ${tokenData.type}`);
	}

	const uploadRes = await fetch(tokenData.uploadUrl, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${tokenData.clientToken}`,
			"Content-Type": "application/octet-stream",
			"x-content-length": String(params.encryptedImage.length),
		},
		body: params.encryptedImage,
	});

	if (!uploadRes.ok) {
		const text = await uploadRes.text();
		throw new Error(`blob upload failed: ${uploadRes.status} ${text}`);
	}

	const blobResult = (await uploadRes.json()) as { url: string };
	return blobResult.url;
}
const PAYLOAD_VERSION = 2;

function mimeTypeForPath(path: string): string {
	const ext = extname(path).slice(1).toLowerCase();
	if (ext === "png") return "image/png";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	return "image/webp";
}

function getHqPath(webpPath: string): string | null {
	if (!webpPath.endsWith(".webp")) return null;
	return webpPath.replace(/\.webp$/, ".hq.png");
}

function getUploadablePath(originalPath: string | null): string | null {
	if (!originalPath) return null;
	if (!existsSync(originalPath)) return null;

	const hqPath = getHqPath(originalPath);
	if (hqPath && existsSync(hqPath)) {
		try {
			const hqStats = statSync(hqPath);
			if (hqStats.size <= MAX_FILE_SIZE_BYTES) {
				logger.debug("Using HQ image for sharing", {
					path: hqPath,
					size: hqStats.size,
				});
				return hqPath;
			}
			logger.debug("HQ image too large, falling back to WebP", {
				hqPath,
				hqSize: hqStats.size,
				limit: MAX_FILE_SIZE_BYTES,
			});
		} catch {}
	}

	try {
		const stats = statSync(originalPath);
		if (stats.size <= MAX_FILE_SIZE_BYTES) {
			return originalPath;
		}
		logger.debug("Image too large", { path: originalPath, size: stats.size });
		return null;
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
	url?: string | null;
	background?: BackgroundContext[];
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
	url: string | null;
	background: BackgroundContext[];
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
		payload.url = params.url;
		if (params.background.length > 0) {
			payload.background = params.background;
		}
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

	await publishEventToRoomInternal(event, roomId);
}

async function publishEventToRoomInternal(
	event: {
		id: string;
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
		originalPath: string | null;
		urlCanonical: string | null;
		contextJson: string | null;
	},
	roomId: string,
): Promise<void> {
	const roomKey = await getRoomKey(roomId);

	const imagePath = getUploadablePath(event.originalPath);
	if (!imagePath) {
		logger.warn("Event image missing or too large", { eventId: event.id });
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
			url: event.urlCanonical,
			background: parseBackgroundFromEvent(event),
			imageRef: null,
			mime,
		}),
	});

	const createRes = await signedFetch(`/api/rooms/${roomId}/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId: event.id,
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

	const imageRef = await uploadImageToBlob({
		roomId,
		eventId: event.id,
		encryptedImage,
	});
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
			url: event.urlCanonical,
			background: parseBackgroundFromEvent(event),
			imageRef,
			mime,
		}),
	});

	const updateRes = await signedFetch(`/api/rooms/${roomId}/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId: event.id,
			timestampMs: event.timestamp,
			payloadCiphertext: payload1,
		}),
	});

	if (!updateRes.ok) {
		const text = await updateRes.text();
		throw new Error(`room event update failed: ${updateRes.status} ${text}`);
	}

	logger.info("Published room event", { eventId: event.id, roomId });
}

export async function publishEventToRoom(params: {
	roomId: string;
	eventId: string;
}): Promise<void> {
	const event = getEventById(params.eventId);
	if (!event) return;
	await publishEventToRoomInternal(event, params.roomId);
}

export type DecryptedRoomEvent = {
	id: string;
	roomId: string;
	authorUserId: string;
	timestampMs: number;
	kind: "shared_event" | "day_wrapped";
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
	dayStartMs?: number;
	slots?: DayWrappedSlot[];
};

function parsePayloadV1(payload: {
	caption?: string | null;
	image?: { ref?: string | null };
}): Omit<DecryptedRoomEvent, "id" | "roomId" | "authorUserId" | "timestampMs"> {
	return {
		kind: "shared_event",
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
		url: null,
		background: [],
		imageRef:
			typeof payload?.image?.ref === "string" ? payload.image.ref : null,
	};
}

function parsePayloadV2(
	payload: SharedEventPayload,
): Omit<DecryptedRoomEvent, "id" | "roomId" | "authorUserId" | "timestampMs"> {
	return {
		kind: "shared_event",
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
		url: payload.url ?? null,
		background: payload.background ?? [],
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

	const decrypted: DecryptedRoomEvent[] = [];
	for (const e of events) {
		try {
			const payloadBytes = decryptRoomEventPayload({
				roomKey,
				payloadCiphertextB64: e.payloadCiphertext,
			});
			const parsedJson = JSON.parse(payloadBytes.toString("utf8")) as unknown;

			const dayWrapped = parseDayWrappedRoomPayload(parsedJson);
			if (dayWrapped) {
				decrypted.push({
					id: e.id,
					roomId: e.roomId,
					authorUserId: e.authorUserId,
					timestampMs: e.timestampMs,
					kind: "day_wrapped",
					endTimestampMs: null,
					project: null,
					category: null,
					caption: null,
					projectProgress: 0,
					appBundleId: null,
					appName: null,
					windowTitle: null,
					contentKind: null,
					contentTitle: null,
					url: null,
					background: [],
					imageRef: null,
					dayStartMs: dayWrapped.dayStartMs,
					slots: dayWrapped.slots,
				});
				continue;
			}

			const payload = parsedJson as SharedEventPayload & {
				v?: number;
				caption?: string | null;
				image?: { ref?: string | null };
			};

			const isV2 = payload.v === PAYLOAD_VERSION;
			const parsed = isV2 ? parsePayloadV2(payload) : parsePayloadV1(payload);

			const imageRef = parsed.imageRef ?? e.imageRef ?? null;

			decrypted.push({
				id: e.id,
				roomId: e.roomId,
				authorUserId: e.authorUserId,
				timestampMs: e.timestampMs,
				kind: "shared_event",
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
				url: parsed.url,
				background: parsed.background,
				imageRef,
			});
		} catch (error) {
			logger.warn("Failed to decrypt room event", {
				roomId: params.roomId,
				eventId: e.id,
				error: String(error),
			});
		}
	}
	return decrypted;
}
