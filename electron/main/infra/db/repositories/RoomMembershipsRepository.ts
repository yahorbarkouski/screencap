import { getDatabase, isDbOpen } from "../connection";

export type RoomMembershipRole = "owner" | "member";

export type RoomMembership = {
	roomId: string;
	roomName: string;
	role: RoomMembershipRole;
	ownerUserId: string;
	ownerUsername: string;
	joinedAt: number;
	lastSyncedAt: number | null;
};

type RoomMembershipRow = {
	room_id: string;
	room_name: string;
	role: string;
	owner_user_id: string;
	owner_username: string;
	joined_at: number;
	last_synced_at: number | null;
};

function rowToMembership(row: RoomMembershipRow): RoomMembership {
	return {
		roomId: row.room_id,
		roomName: row.room_name,
		role: row.role as RoomMembershipRole,
		ownerUserId: row.owner_user_id,
		ownerUsername: row.owner_username,
		joinedAt: row.joined_at,
		lastSyncedAt: row.last_synced_at,
	};
}

export function getRoomMembership(roomId: string): RoomMembership | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT room_id, room_name, role, owner_user_id, owner_username, joined_at, last_synced_at
			 FROM room_memberships WHERE room_id = ?`,
		)
		.get(roomId) as RoomMembershipRow | undefined;
	if (!row) return null;
	return rowToMembership(row);
}

export function listRoomMemberships(): RoomMembership[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT room_id, room_name, role, owner_user_id, owner_username, joined_at, last_synced_at
			 FROM room_memberships ORDER BY joined_at DESC`,
		)
		.all() as RoomMembershipRow[];
	return rows.map(rowToMembership);
}

export function listRoomMembershipsByRole(
	role: RoomMembershipRole,
): RoomMembership[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT room_id, room_name, role, owner_user_id, owner_username, joined_at, last_synced_at
			 FROM room_memberships WHERE role = ? ORDER BY joined_at DESC`,
		)
		.all(role) as RoomMembershipRow[];
	return rows.map(rowToMembership);
}

export function upsertRoomMembership(membership: RoomMembership): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`INSERT INTO room_memberships (room_id, room_name, role, owner_user_id, owner_username, joined_at, last_synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (room_id) DO UPDATE SET
			room_name = excluded.room_name,
			role = excluded.role,
			owner_user_id = excluded.owner_user_id,
			owner_username = excluded.owner_username,
			last_synced_at = excluded.last_synced_at`,
	).run(
		membership.roomId,
		membership.roomName,
		membership.role,
		membership.ownerUserId,
		membership.ownerUsername,
		membership.joinedAt,
		membership.lastSyncedAt,
	);
}

export function updateRoomMembershipLastSynced(
	roomId: string,
	lastSyncedAt: number,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		"UPDATE room_memberships SET last_synced_at = ? WHERE room_id = ?",
	).run(lastSyncedAt, roomId);
}

export function deleteRoomMembership(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_memberships WHERE room_id = ?").run(roomId);
}
