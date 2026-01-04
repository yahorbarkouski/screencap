import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import type { RoomInvite } from "../../../shared/types";
import { getDistinctProjects } from "../../infra/db/repositories/EventRepository";
import { insertMemory } from "../../infra/db/repositories/MemoryRepository";
import {
	getRoomIdForProject,
	upsertProjectRoomLink,
} from "../../infra/db/repositories/ProjectRoomLinkRepository";
import {
	hasPendingInvite,
	listSentInvitesForRoom,
	markInviteAccepted,
	type SentInvite,
	upsertSentInvite,
} from "../../infra/db/repositories/RoomInvitesSentRepository";
import {
	getRoomKeyCache,
	upsertRoomKeyCache,
} from "../../infra/db/repositories/RoomKeysCacheRepository";
import {
	listRoomMembers,
	upsertRoomMembersBatch,
} from "../../infra/db/repositories/RoomMembersCacheRepository";
import { upsertRoomMembership } from "../../infra/db/repositories/RoomMembershipsRepository";
import { createLogger } from "../../infra/log";
import { normalizeProjectBase, projectKeyFromBase } from "../projects";
import {
	getDhPrivateKeyPkcs8DerB64,
	getIdentity,
	signedFetch,
} from "../social/IdentityService";
import {
	createRoomKeyEnvelope,
	decodeRoomKeyB64,
	encodeRoomKeyB64,
	generateRoomKey,
	openRoomKeyEnvelope,
} from "./RoomCrypto";

const logger = createLogger({ scope: "RoomsService" });

type StoredSecret = { scheme: "safeStorage" | "plain"; payload: string };

function encryptSecret(value: string): StoredSecret {
	if (!safeStorage.isEncryptionAvailable()) {
		return { scheme: "plain", payload: value };
	}
	return {
		scheme: "safeStorage",
		payload: safeStorage.encryptString(value).toString("base64"),
	};
}

function decryptSecret(secret: StoredSecret): string | null {
	try {
		if (secret.scheme === "plain") return secret.payload;
		return safeStorage.decryptString(Buffer.from(secret.payload, "base64"));
	} catch {
		return null;
	}
}

function encodeSecretJson(secret: StoredSecret): string {
	return JSON.stringify(secret);
}

function decodeSecretJson(encoded: string): StoredSecret | null {
	try {
		const parsed = JSON.parse(encoded) as Partial<StoredSecret>;
		if (
			(parsed.scheme !== "plain" && parsed.scheme !== "safeStorage") ||
			typeof parsed.payload !== "string"
		) {
			return null;
		}
		return { scheme: parsed.scheme, payload: parsed.payload };
	} catch {
		return null;
	}
}

async function createRoomOnServer(params: {
	name: string;
	visibility: "private" | "public";
}): Promise<{ roomId: string }> {
	const res = await signedFetch("/api/rooms", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			kind: "project",
			name: params.name,
			visibility: params.visibility,
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`createRoom failed: ${res.status} ${text}`);
	}
	const room = (await res.json()) as { id: string };
	return { roomId: room.id };
}

export async function ensureRoomForProject(params: {
	projectName: string;
	visibility?: "private" | "public";
}): Promise<string> {
	const existing = getRoomIdForProject(params.projectName);
	if (existing) return existing;

	const identity = getIdentity();
	if (!identity) {
		throw new Error("Not authenticated");
	}

	const roomKey = generateRoomKey();
	const { roomId } = await createRoomOnServer({
		name: params.projectName,
		visibility: params.visibility ?? "private",
	});

	const now = Date.now();

	upsertProjectRoomLink({
		projectName: params.projectName,
		roomId,
		createdAt: now,
	});

	upsertRoomMembership({
		roomId,
		roomName: params.projectName,
		role: "owner",
		ownerUserId: identity.userId,
		ownerUsername: identity.username,
		joinedAt: now,
		lastSyncedAt: null,
	});

	const roomKeyB64 = encodeRoomKeyB64(roomKey);
	const roomKeyEnc = encodeSecretJson(encryptSecret(roomKeyB64));
	upsertRoomKeyCache({ roomId, roomKeyEnc, updatedAt: now });

	logger.info("Created room for project", {
		projectName: params.projectName,
		roomId,
	});
	return roomId;
}

export async function getRoomKey(roomId: string): Promise<Buffer> {
	const cached = getRoomKeyCache(roomId);
	if (cached) {
		const secret = decodeSecretJson(cached.roomKeyEnc);
		const decrypted = secret ? decryptSecret(secret) : null;
		if (decrypted) {
			return decodeRoomKeyB64(decrypted);
		}
	}

	const res = await signedFetch(`/api/rooms/${roomId}/keys`, { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`getRoomKey failed: ${res.status} ${text}`);
	}
	const { envelopeJson } = (await res.json()) as { envelopeJson: string };
	const roomKey = openRoomKeyEnvelope({
		envelopeJson,
		recipientDhPrivKeyPkcs8DerB64: getDhPrivateKeyPkcs8DerB64(),
	});

	const roomKeyB64 = encodeRoomKeyB64(roomKey);
	const roomKeyEnc = encodeSecretJson(encryptSecret(roomKeyB64));
	upsertRoomKeyCache({ roomId, roomKeyEnc, updatedAt: Date.now() });

	return roomKey;
}

export type InviteStatus = "pending" | "member" | "none";

export function getInviteStatusForFriend(
	roomId: string,
	friendUserId: string,
): InviteStatus {
	const members = listRoomMembers(roomId);
	if (members.some((m) => m.userId === friendUserId)) {
		return "member";
	}

	if (hasPendingInvite(roomId, friendUserId)) {
		return "pending";
	}

	return "none";
}

export function listSentInvites(roomId: string): SentInvite[] {
	return listSentInvitesForRoom(roomId);
}

export type RoomMember = {
	userId: string;
	username: string;
	role: string;
};

export async function fetchAndSyncRoomMembers(
	roomId: string,
): Promise<RoomMember[]> {
	const identity = getIdentity();
	if (!identity) {
		return listRoomMembers(roomId);
	}

	try {
		const res = await signedFetch(`/api/rooms/${roomId}/members`, {
			method: "GET",
		});

		if (!res.ok) {
			logger.warn("Failed to fetch room members from server", {
				roomId,
				status: res.status,
			});
			return listRoomMembers(roomId);
		}

		const serverMembers = (await res.json()) as RoomMember[];

		if (serverMembers.length > 0) {
			upsertRoomMembersBatch(
				serverMembers.map((m) => ({
					roomId,
					userId: m.userId,
					username: m.username,
					role: m.role,
				})),
			);

			const memberUserIds = new Set(serverMembers.map((m) => m.userId));
			const pendingInvites = listSentInvitesForRoom(roomId).filter(
				(i) => i.status === "pending",
			);

			for (const invite of pendingInvites) {
				if (memberUserIds.has(invite.toUserId)) {
					markInviteAccepted(roomId, invite.toUserId);
					logger.info("Marked invite as accepted - user is now member", {
						roomId,
						userId: invite.toUserId,
					});
				}
			}
		}

		return serverMembers;
	} catch (error) {
		logger.warn("Error fetching room members from server", {
			roomId,
			error: String(error),
		});
		return listRoomMembers(roomId);
	}
}

export async function inviteFriendToProjectRoom(params: {
	projectName: string;
	friendUserId: string;
	friendUsername?: string;
}): Promise<{ status: "invited" | "already_member" | "already_invited" }> {
	const roomId = await ensureRoomForProject({
		projectName: params.projectName,
	});

	const existingStatus = getInviteStatusForFriend(roomId, params.friendUserId);
	if (existingStatus === "member") {
		logger.info("Friend is already a member", {
			projectName: params.projectName,
			friendUserId: params.friendUserId,
		});
		return { status: "already_member" };
	}

	if (existingStatus === "pending") {
		logger.info("Friend already has pending invite", {
			projectName: params.projectName,
			friendUserId: params.friendUserId,
		});
		return { status: "already_invited" };
	}

	const roomKey = await getRoomKey(roomId);

	const inviteRes = await signedFetch(`/api/rooms/${roomId}/invites`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ toUserId: params.friendUserId }),
	});

	if (!inviteRes.ok) {
		const text = await inviteRes.text();
		throw new Error(`inviteFriend failed: ${inviteRes.status} ${text}`);
	}

	const invite = (await inviteRes.json()) as {
		inviteId: string;
		devices: Array<{ deviceId: string; dhPubKey: string }>;
	};

	if (!invite.devices || invite.devices.length === 0) {
		throw new Error("Invitee has no registered devices");
	}

	const envelopes = invite.devices.map((d) => ({
		deviceId: d.deviceId,
		envelopeJson: JSON.stringify(
			createRoomKeyEnvelope({
				roomKey,
				recipientDhPubKeySpkiDerB64: d.dhPubKey,
			}),
		),
	}));

	const keyRes = await signedFetch(`/api/rooms/${roomId}/keys`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ envelopes }),
	});

	if (!keyRes.ok) {
		const text = await keyRes.text();
		throw new Error(`upload envelopes failed: ${keyRes.status} ${text}`);
	}

	upsertSentInvite({
		id: invite.inviteId,
		roomId,
		toUserId: params.friendUserId,
		toUsername: params.friendUsername ?? "unknown",
		sentAt: Date.now(),
		status: "pending",
	});

	logger.info("Invited friend to room", {
		projectName: params.projectName,
		roomId,
		inviteId: invite.inviteId,
		friendUserId: params.friendUserId,
	});

	return { status: "invited" };
}

export type Room = {
	id: string;
	kind: "project";
	name: string;
	visibility: "private" | "public";
	role: "owner" | "member";
	createdBy: string;
	createdAt: number;
};

export async function listRooms(): Promise<Room[]> {
	const res = await signedFetch("/api/rooms", { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`listRooms failed: ${res.status} ${text}`);
	}
	return (await res.json()) as Room[];
}

export async function listIncomingRoomInvites(): Promise<RoomInvite[]> {
	const res = await signedFetch("/api/rooms/invites", { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`listIncomingRoomInvites failed: ${res.status} ${text}`);
	}
	return (await res.json()) as RoomInvite[];
}

export async function acceptRoomInvite(params: {
	roomId: string;
	roomName: string;
	ownerUserId: string;
	ownerUsername: string;
}): Promise<void> {
	await getRoomKey(params.roomId);

	const now = Date.now();

	upsertRoomMembership({
		roomId: params.roomId,
		roomName: params.roomName,
		role: "member",
		ownerUserId: params.ownerUserId,
		ownerUsername: params.ownerUsername,
		joinedAt: now,
		lastSyncedAt: null,
	});

	const localProjects = getDistinctProjects();
	const roomNameKey = projectKeyFromBase(normalizeProjectBase(params.roomName));
	const matchingLocalProject = localProjects.find(
		(p) => projectKeyFromBase(normalizeProjectBase(p)) === roomNameKey,
	);

	let linkedProjectName: string;

	if (matchingLocalProject) {
		linkedProjectName = matchingLocalProject;
		const existingRoomId = getRoomIdForProject(matchingLocalProject);
		if (!existingRoomId) {
			upsertProjectRoomLink({
				projectName: matchingLocalProject,
				roomId: params.roomId,
				createdAt: now,
			});
			logger.info("Auto-linked existing local project to room", {
				projectName: matchingLocalProject,
				roomId: params.roomId,
			});
		}
	} else {
		linkedProjectName = params.roomName;

		insertMemory({
			id: randomUUID(),
			type: "project",
			content: params.roomName,
			description: `Shared by @${params.ownerUsername}`,
			createdAt: now,
			updatedAt: now,
		});

		upsertProjectRoomLink({
			projectName: params.roomName,
			roomId: params.roomId,
			createdAt: now,
		});

		logger.info("Created new local project from room invite", {
			projectName: params.roomName,
			roomId: params.roomId,
			ownerUsername: params.ownerUsername,
		});
	}

	logger.info("Accepted room invite", {
		roomId: params.roomId,
		roomName: params.roomName,
		ownerUsername: params.ownerUsername,
		linkedLocalProject: linkedProjectName,
	});

	void triggerBackfillSync(params.roomId);
}

async function triggerBackfillSync(roomId: string): Promise<void> {
	try {
		const { syncRoomWithBackfill } = await import(
			"../sharedProjects/SharedProjectsService"
		);
		await syncRoomWithBackfill(roomId);
		logger.info("Backfill sync completed for room", { roomId });
	} catch (error) {
		logger.warn("Backfill sync failed", { roomId, error: String(error) });
	}
}

export async function acceptProjectRoomInvite(params: {
	roomId: string;
	projectName: string;
}): Promise<void> {
	await acceptRoomInvite({
		roomId: params.roomId,
		roomName: params.projectName,
		ownerUserId: "",
		ownerUsername: "Unknown",
	});
}
