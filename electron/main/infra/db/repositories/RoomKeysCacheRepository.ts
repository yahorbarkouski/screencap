import { getDatabase, isDbOpen } from "../connection";

export type RoomKeyCacheRow = {
	roomId: string;
	roomKeyEnc: string;
	updatedAt: number;
};

export function getRoomKeyCache(roomId: string): RoomKeyCacheRow | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			"SELECT room_id, room_key_enc, updated_at FROM room_keys_cache WHERE room_id = ?",
		)
		.get(roomId) as
		| { room_id: string; room_key_enc: string; updated_at: number }
		| undefined;
	if (!row) return null;
	return {
		roomId: row.room_id,
		roomKeyEnc: row.room_key_enc,
		updatedAt: row.updated_at,
	};
}

export function upsertRoomKeyCache(params: RoomKeyCacheRow): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
    INSERT INTO room_keys_cache (room_id, room_key_enc, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (room_id) DO UPDATE SET
      room_key_enc = excluded.room_key_enc,
      updated_at = excluded.updated_at
  `,
	).run(params.roomId, params.roomKeyEnc, params.updatedAt);
}

export function listRoomKeysCache(): RoomKeyCacheRow[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare("SELECT room_id, room_key_enc, updated_at FROM room_keys_cache")
		.all() as Array<{
		room_id: string;
		room_key_enc: string;
		updated_at: number;
	}>;
	return rows.map((row) => ({
		roomId: row.room_id,
		roomKeyEnc: row.room_key_enc,
		updatedAt: row.updated_at,
	}));
}

export function deleteRoomKeyCache(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_keys_cache WHERE room_id = ?").run(roomId);
}
