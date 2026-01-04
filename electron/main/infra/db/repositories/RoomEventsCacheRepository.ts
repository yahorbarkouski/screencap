import { getDatabase, isDbOpen } from "../connection";

export type CachedRoomEvent = {
	id: string;
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	timestampMs: number;
	caption: string | null;
	imageCachePath: string | null;
	syncedAt: number;
};

type CachedRoomEventRow = {
	id: string;
	room_id: string;
	author_user_id: string;
	author_username: string;
	timestamp_ms: number;
	caption: string | null;
	image_cache_path: string | null;
	synced_at: number;
};

function rowToEvent(row: CachedRoomEventRow): CachedRoomEvent {
	return {
		id: row.id,
		roomId: row.room_id,
		authorUserId: row.author_user_id,
		authorUsername: row.author_username,
		timestampMs: row.timestamp_ms,
		caption: row.caption,
		imageCachePath: row.image_cache_path,
		syncedAt: row.synced_at,
	};
}

export function getCachedRoomEvent(eventId: string): CachedRoomEvent | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT id, room_id, author_user_id, author_username, timestamp_ms, caption, image_cache_path, synced_at
			 FROM room_events_cache WHERE id = ?`,
		)
		.get(eventId) as CachedRoomEventRow | undefined;
	if (!row) return null;
	return rowToEvent(row);
}

export function listCachedRoomEvents(params: {
	roomId: string;
	excludeAuthorId?: string;
	startDate?: number;
	endDate?: number;
	limit?: number;
}): CachedRoomEvent[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();

	const conditions: string[] = ["room_id = ?"];
	const args: (string | number)[] = [params.roomId];

	if (params.excludeAuthorId) {
		conditions.push("author_user_id != ?");
		args.push(params.excludeAuthorId);
	}

	if (params.startDate !== undefined) {
		conditions.push("timestamp_ms >= ?");
		args.push(params.startDate);
	}

	if (params.endDate !== undefined) {
		conditions.push("timestamp_ms <= ?");
		args.push(params.endDate);
	}

	let sql = `SELECT id, room_id, author_user_id, author_username, timestamp_ms, caption, image_cache_path, synced_at
		FROM room_events_cache
		WHERE ${conditions.join(" AND ")}
		ORDER BY timestamp_ms DESC`;

	if (params.limit !== undefined) {
		sql += ` LIMIT ${params.limit}`;
	}

	const rows = db.prepare(sql).all(...args) as CachedRoomEventRow[];
	return rows.map(rowToEvent);
}

export function upsertCachedRoomEvent(event: CachedRoomEvent): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`INSERT INTO room_events_cache (id, room_id, author_user_id, author_username, timestamp_ms, caption, image_cache_path, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET
			room_id = excluded.room_id,
			author_user_id = excluded.author_user_id,
			author_username = excluded.author_username,
			timestamp_ms = excluded.timestamp_ms,
			caption = excluded.caption,
			image_cache_path = excluded.image_cache_path,
			synced_at = excluded.synced_at`,
	).run(
		event.id,
		event.roomId,
		event.authorUserId,
		event.authorUsername,
		event.timestampMs,
		event.caption,
		event.imageCachePath,
		event.syncedAt,
	);
}

export function upsertCachedRoomEventsBatch(events: CachedRoomEvent[]): void {
	if (!isDbOpen()) return;
	if (events.length === 0) return;
	const db = getDatabase();
	const stmt = db.prepare(
		`INSERT INTO room_events_cache (id, room_id, author_user_id, author_username, timestamp_ms, caption, image_cache_path, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET
			room_id = excluded.room_id,
			author_user_id = excluded.author_user_id,
			author_username = excluded.author_username,
			timestamp_ms = excluded.timestamp_ms,
			caption = excluded.caption,
			image_cache_path = excluded.image_cache_path,
			synced_at = excluded.synced_at`,
	);

	db.transaction(() => {
		for (const event of events) {
			stmt.run(
				event.id,
				event.roomId,
				event.authorUserId,
				event.authorUsername,
				event.timestampMs,
				event.caption,
				event.imageCachePath,
				event.syncedAt,
			);
		}
	})();
}

export function updateCachedEventImagePath(
	eventId: string,
	imageCachePath: string,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		"UPDATE room_events_cache SET image_cache_path = ? WHERE id = ?",
	).run(imageCachePath, eventId);
}

export function deleteCachedRoomEvents(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_events_cache WHERE room_id = ?").run(roomId);
}

export function getLatestCachedEventTimestamp(roomId: string): number | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			"SELECT MAX(timestamp_ms) as max_ts FROM room_events_cache WHERE room_id = ?",
		)
		.get(roomId) as { max_ts: number | null } | undefined;
	return row?.max_ts ?? null;
}
