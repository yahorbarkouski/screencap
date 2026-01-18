import { createLogger } from "../../infra/log";
import { handleForbiddenRoomError } from "../rooms/RoomAccess";
import {
	decryptWithKey,
	deriveDmKey,
	deriveProjectChatKey,
	encryptWithKey,
} from "../rooms/RoomCrypto";
import { getRoomKey } from "../rooms/RoomsService";
import { listFriends } from "../social/FriendsService";
import {
	getDhPrivateKeyPkcs8DerB64,
	getIdentity,
	signedFetch,
} from "../social/IdentityService";

const logger = createLogger({ scope: "ChatService" });

export type ChatThread = {
	id: string;
	kind: "dm" | "project";
	roomId: string | null;
	title: string;
	createdAt: number;
};

export type ChatMessage = {
	id: string;
	threadId: string;
	authorUserId: string;
	timestampMs: number;
	text: string;
};

function parseThreadKind(threadId: string): "dm" | "project" {
	if (threadId.startsWith("dm_")) return "dm";
	if (threadId.startsWith("project_")) return "project";
	throw new Error("Unknown thread kind");
}

function parseDmPeerUserId(params: {
	threadId: string;
	myUserId: string;
}): string {
	const parts = params.threadId.split("_");
	if (parts.length !== 3 || parts[0] !== "dm") {
		throw new Error("Invalid DM threadId");
	}
	const a = parts[1];
	const b = parts[2];
	if (a === params.myUserId) return b;
	if (b === params.myUserId) return a;
	throw new Error("DM thread does not include current user");
}

function parseProjectRoomId(threadId: string): string {
	if (!threadId.startsWith("project_"))
		throw new Error("Invalid project threadId");
	return threadId.slice("project_".length);
}

async function getDmKey(threadId: string): Promise<Buffer> {
	const identity = getIdentity();
	if (!identity) throw new Error("Identity not registered");
	const peerUserId = parseDmPeerUserId({ threadId, myUserId: identity.userId });

	const friends = await listFriends();
	const peer = friends.find((f) => f.userId === peerUserId);
	if (!peer?.dhPubKey) throw new Error("Missing peer device key");

	return deriveDmKey({
		myDhPrivKeyPkcs8DerB64: getDhPrivateKeyPkcs8DerB64(),
		peerDhPubKeySpkiDerB64: peer.dhPubKey,
	});
}

async function getProjectChatKey(threadId: string): Promise<Buffer> {
	const roomId = parseProjectRoomId(threadId);
	const roomKey = await getRoomKey(roomId);
	return deriveProjectChatKey({ roomKey });
}

async function getThreadKey(threadId: string): Promise<Buffer> {
	const kind = parseThreadKind(threadId);
	if (kind === "dm") return await getDmKey(threadId);
	return await getProjectChatKey(threadId);
}

export async function listThreads(): Promise<ChatThread[]> {
	const res = await signedFetch("/api/chats", { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`listThreads failed: ${res.status} ${text}`);
	}
	return (await res.json()) as ChatThread[];
}

export async function openDmThread(friendUserId: string): Promise<string> {
	const res = await signedFetch("/api/chats/dm", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ friendUserId }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`openDmThread failed: ${res.status} ${text}`);
	}
	const { threadId } = (await res.json()) as { threadId: string };
	return threadId;
}

export async function openProjectThread(roomId: string): Promise<string> {
	const res = await signedFetch(`/api/chats/project/${roomId}`, {
		method: "POST",
	});
	if (!res.ok) {
		const text = await res.text();
		if (res.status === 403) {
			handleForbiddenRoomError({
				roomId,
				error: { status: res.status, message: text },
				source: "open_project_thread",
			});
		}
		throw new Error(`openProjectThread failed: ${res.status} ${text}`);
	}
	const { threadId } = (await res.json()) as { threadId: string };
	return threadId;
}

export async function fetchMessages(params: {
	threadId: string;
	since?: number;
	limit?: number;
}): Promise<ChatMessage[]> {
	const qp = new URLSearchParams();
	if (params.since !== undefined) qp.set("since", String(params.since));
	if (params.limit !== undefined) qp.set("limit", String(params.limit));
	const url =
		qp.size > 0
			? `/api/chats/${params.threadId}/messages?${qp}`
			: `/api/chats/${params.threadId}/messages`;

	const res = await signedFetch(url, { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		if (res.status === 403) {
			let roomId: string | null = null;
			try {
				if (parseThreadKind(params.threadId) === "project") {
					roomId = parseProjectRoomId(params.threadId);
				}
			} catch {}
			if (roomId) {
				handleForbiddenRoomError({
					roomId,
					error: { status: res.status, message: text },
					source: "fetch_chat_messages",
				});
			}
		}
		throw new Error(`fetchMessages failed: ${res.status} ${text}`);
	}

	const key = await getThreadKey(params.threadId);
	const messages = (await res.json()) as Array<{
		id: string;
		threadId: string;
		authorUserId: string;
		timestampMs: number;
		ciphertext: string;
	}>;

	return messages.map((m) => {
		const bytes = decryptWithKey({ key, ciphertextB64: m.ciphertext });
		const payload = JSON.parse(bytes.toString("utf8")) as {
			v?: number;
			text?: string;
		};
		return {
			id: m.id,
			threadId: m.threadId,
			authorUserId: m.authorUserId,
			timestampMs: m.timestampMs,
			text: typeof payload?.text === "string" ? payload.text : "",
		};
	});
}

export async function sendMessage(params: {
	threadId: string;
	text: string;
}): Promise<void> {
	const key = await getThreadKey(params.threadId);
	const payload = Buffer.from(
		JSON.stringify({ v: 1, text: params.text }),
		"utf8",
	);
	const ciphertext = encryptWithKey({ key, plaintextUtf8: payload });

	const res = await signedFetch(`/api/chats/${params.threadId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			timestampMs: Date.now(),
			ciphertext,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`sendMessage failed: ${res.status} ${text}`);
	}

	logger.info("Sent message", { threadId: params.threadId });
}
