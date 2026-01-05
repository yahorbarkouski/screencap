import type { AvatarSettings } from "../../../shared/types";
import { signedFetch } from "./IdentityService";

export type Friend = {
	userId: string;
	username: string;
	deviceId: string | null;
	dhPubKey: string | null;
	avatarSettings: AvatarSettings | null;
	createdAt: number;
};

export type FriendRequest = {
	id: string;
	fromUserId: string;
	fromUsername: string;
	toUserId: string;
	toUsername: string;
	status: "pending" | "accepted" | "rejected";
	createdAt: number;
	respondedAt: number | null;
};

export async function sendFriendRequest(toUsername: string): Promise<{
	requestId: string;
	status: "pending" | "accepted";
}> {
	const res = await signedFetch("/api/friends/requests", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ toUsername: toUsername.trim().toLowerCase() }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`sendFriendRequest failed: ${res.status} ${text}`);
	}
	return (await res.json()) as {
		requestId: string;
		status: "pending" | "accepted";
	};
}

export async function listFriends(): Promise<Friend[]> {
	const res = await signedFetch("/api/friends", { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`listFriends failed: ${res.status} ${text}`);
	}
	return (await res.json()) as Friend[];
}

export async function listFriendRequests(): Promise<FriendRequest[]> {
	const res = await signedFetch("/api/friends/requests", { method: "GET" });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`listFriendRequests failed: ${res.status} ${text}`);
	}
	return (await res.json()) as FriendRequest[];
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
	const res = await signedFetch(`/api/friends/requests/${requestId}/accept`, {
		method: "POST",
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`acceptFriendRequest failed: ${res.status} ${text}`);
	}
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
	const res = await signedFetch(`/api/friends/requests/${requestId}/reject`, {
		method: "POST",
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`rejectFriendRequest failed: ${res.status} ${text}`);
	}
}
