import { getDatabase, isDbOpen } from "../connection";

export type CachedRoomMember = {
	roomId: string;
	userId: string;
	username: string;
	role: string;
};

type CachedRoomMemberRow = {
	room_id: string;
	user_id: string;
	username: string;
	role: string;
};

function rowToMember(row: CachedRoomMemberRow): CachedRoomMember {
	return {
		roomId: row.room_id,
		userId: row.user_id,
		username: row.username,
		role: row.role,
	};
}

export function listRoomMembers(roomId: string): CachedRoomMember[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT room_id, user_id, username, role
			 FROM room_members_cache WHERE room_id = ?`,
		)
		.all(roomId) as CachedRoomMemberRow[];
	return rows.map(rowToMember);
}

export function getRoomMember(
	roomId: string,
	userId: string,
): CachedRoomMember | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT room_id, user_id, username, role
			 FROM room_members_cache WHERE room_id = ? AND user_id = ?`,
		)
		.get(roomId, userId) as CachedRoomMemberRow | undefined;
	if (!row) return null;
	return rowToMember(row);
}

export function upsertRoomMember(member: CachedRoomMember): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`INSERT INTO room_members_cache (room_id, user_id, username, role)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT (room_id, user_id) DO UPDATE SET
			username = excluded.username,
			role = excluded.role`,
	).run(member.roomId, member.userId, member.username, member.role);
}

export function upsertRoomMembersBatch(members: CachedRoomMember[]): void {
	if (!isDbOpen()) return;
	if (members.length === 0) return;
	const db = getDatabase();
	const stmt = db.prepare(
		`INSERT INTO room_members_cache (room_id, user_id, username, role)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT (room_id, user_id) DO UPDATE SET
			username = excluded.username,
			role = excluded.role`,
	);

	db.transaction(() => {
		for (const member of members) {
			stmt.run(member.roomId, member.userId, member.username, member.role);
		}
	})();
}

export function deleteRoomMembers(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_members_cache WHERE room_id = ?").run(roomId);
}

export function getUsernameFromCache(
	roomId: string,
	userId: string,
): string | null {
	const member = getRoomMember(roomId, userId);
	return member?.username ?? null;
}
