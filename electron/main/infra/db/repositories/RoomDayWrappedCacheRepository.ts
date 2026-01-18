import type { DayWrappedSlot } from "../../../../shared/types";
import { getDatabase, isDbOpen } from "../connection";

export type CachedDayWrapped = {
	id: string;
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	timestampMs: number;
	dayStartMs: number;
	slots: DayWrappedSlot[];
	syncedAt: number;
};

type CachedDayWrappedRow = {
	id: string;
	room_id: string;
	author_user_id: string;
	author_username: string;
	timestamp_ms: number;
	day_start_ms: number;
	slots_json: string;
	synced_at: number;
};

function rowToDayWrapped(row: CachedDayWrappedRow): CachedDayWrapped | null {
	let slots: DayWrappedSlot[];
	try {
		slots = JSON.parse(row.slots_json) as DayWrappedSlot[];
	} catch {
		return null;
	}

	if (!Array.isArray(slots)) return null;

	return {
		id: row.id,
		roomId: row.room_id,
		authorUserId: row.author_user_id,
		authorUsername: row.author_username,
		timestampMs: row.timestamp_ms,
		dayStartMs: row.day_start_ms,
		slots,
		syncedAt: row.synced_at,
	};
}

export function getLatestCachedDayWrappedTimestamp(
	roomId: string,
): number | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			"SELECT MAX(timestamp_ms) AS ts FROM room_day_wrapped_cache WHERE room_id = ?",
		)
		.get(roomId) as { ts: number | null } | undefined;
	return row?.ts ?? null;
}

export function upsertCachedDayWrappedBatch(events: CachedDayWrapped[]): void {
	if (!isDbOpen()) return;
	if (events.length === 0) return;
	const db = getDatabase();
	const stmt = db.prepare(
		`INSERT INTO room_day_wrapped_cache (
			id, room_id, author_user_id, author_username, timestamp_ms, day_start_ms, slots_json, synced_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			room_id = excluded.room_id,
			author_user_id = excluded.author_user_id,
			author_username = excluded.author_username,
			timestamp_ms = excluded.timestamp_ms,
			day_start_ms = excluded.day_start_ms,
			slots_json = excluded.slots_json,
			synced_at = excluded.synced_at`,
	);

	db.transaction(() => {
		for (const e of events) {
			stmt.run(
				e.id,
				e.roomId,
				e.authorUserId,
				e.authorUsername,
				e.timestampMs,
				e.dayStartMs,
				JSON.stringify(e.slots),
				e.syncedAt,
			);
		}
	})();
}

export function deleteCachedDayWrapped(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM room_day_wrapped_cache WHERE room_id = ?").run(
		roomId,
	);
}

export function getLatestCachedDayWrappedForAuthor(params: {
	roomId: string;
	authorUserId: string;
}): CachedDayWrapped | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(
			`SELECT id, room_id, author_user_id, author_username, timestamp_ms, day_start_ms, slots_json, synced_at
			 FROM room_day_wrapped_cache
			 WHERE room_id = ? AND author_user_id = ?
			 ORDER BY timestamp_ms DESC
			 LIMIT 1`,
		)
		.get(params.roomId, params.authorUserId) as CachedDayWrappedRow | undefined;
	if (!row) return null;
	return rowToDayWrapped(row);
}
