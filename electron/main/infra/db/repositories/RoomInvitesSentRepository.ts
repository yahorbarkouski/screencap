import { getDatabase, isDbOpen } from "../connection";

export type SentInviteStatus = "pending" | "accepted" | "declined" | "expired";

export type SentInvite = {
	id: string;
	roomId: string;
	toUserId: string;
	toUsername: string;
	sentAt: number;
	status: SentInviteStatus;
};

type SentInviteRow = {
	id: string;
	room_id: string;
	to_user_id: string;
	to_username: string;
	sent_at: number;
	status: string;
};

function rowToInvite(row: SentInviteRow): SentInvite {
	return {
		id: row.id,
		roomId: row.room_id,
		toUserId: row.to_user_id,
		toUsername: row.to_username,
		sentAt: row.sent_at,
		status: row.status as SentInviteStatus,
	};
}

export function listSentInvitesForRoom(roomId: string): SentInvite[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT id, room_id, to_user_id, to_username, sent_at, status
			 FROM room_invites_sent WHERE room_id = ?
			 ORDER BY sent_at DESC`,
		)
		.all(roomId) as SentInviteRow[];
	return rows.map(rowToInvite);
}

export function getSentInvite(
	roomId: string,
	toUserId: string,
): SentInvite | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT id, room_id, to_user_id, to_username, sent_at, status
			 FROM room_invites_sent WHERE room_id = ? AND to_user_id = ?`,
		)
		.get(roomId, toUserId) as SentInviteRow | undefined;
	if (!row) return null;
	return rowToInvite(row);
}

export function hasPendingInvite(roomId: string, toUserId: string): boolean {
	if (!isDbOpen()) return false;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT 1 FROM room_invites_sent 
			 WHERE room_id = ? AND to_user_id = ? AND status = 'pending'`,
		)
		.get(roomId, toUserId);
	return !!row;
}

export function upsertSentInvite(invite: SentInvite): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`INSERT INTO room_invites_sent (id, room_id, to_user_id, to_username, sent_at, status)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (room_id, to_user_id) DO UPDATE SET
			id = excluded.id,
			to_username = excluded.to_username,
			sent_at = excluded.sent_at,
			status = excluded.status`,
	).run(
		invite.id,
		invite.roomId,
		invite.toUserId,
		invite.toUsername,
		invite.sentAt,
		invite.status,
	);
}

export function updateSentInviteStatus(
	roomId: string,
	toUserId: string,
	status: SentInviteStatus,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`UPDATE room_invites_sent SET status = ? WHERE room_id = ? AND to_user_id = ?`,
	).run(status, roomId, toUserId);
}

export function markInviteAccepted(roomId: string, toUserId: string): void {
	updateSentInviteStatus(roomId, toUserId, "accepted");
}

export function deleteSentInvitesForRoom(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_invites_sent WHERE room_id = ?").run(roomId);
}

export function deleteSentInvite(roomId: string, toUserId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		"DELETE FROM room_invites_sent WHERE room_id = ? AND to_user_id = ?",
	).run(roomId, toUserId);
}
