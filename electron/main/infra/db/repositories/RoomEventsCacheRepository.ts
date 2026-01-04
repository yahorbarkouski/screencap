import { getDatabase, isDbOpen } from "../connection";

export type CachedRoomEvent = {
	id: string;
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	timestampMs: number;
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
	thumbnailPath: string | null;
	originalPath: string | null;
	syncedAt: number;
};

type CachedRoomEventRow = {
	id: string;
	room_id: string;
	author_user_id: string;
	author_username: string;
	timestamp_ms: number;
	end_timestamp_ms: number | null;
	project: string | null;
	category: string | null;
	caption: string | null;
	project_progress: number;
	app_bundle_id: string | null;
	app_name: string | null;
	window_title: string | null;
	content_kind: string | null;
	content_title: string | null;
	thumbnail_path: string | null;
	original_path: string | null;
	synced_at: number;
};

function rowToEvent(row: CachedRoomEventRow): CachedRoomEvent {
	return {
		id: row.id,
		roomId: row.room_id,
		authorUserId: row.author_user_id,
		authorUsername: row.author_username,
		timestampMs: row.timestamp_ms,
		endTimestampMs: row.end_timestamp_ms,
		project: row.project,
		category: row.category,
		caption: row.caption,
		projectProgress: row.project_progress ?? 0,
		appBundleId: row.app_bundle_id,
		appName: row.app_name,
		windowTitle: row.window_title,
		contentKind: row.content_kind,
		contentTitle: row.content_title,
		thumbnailPath: row.thumbnail_path,
		originalPath: row.original_path,
		syncedAt: row.synced_at,
	};
}

const ALL_COLUMNS = `id, room_id, author_user_id, author_username, timestamp_ms, end_timestamp_ms,
	project, category, caption, project_progress, app_bundle_id, app_name, window_title,
	content_kind, content_title, thumbnail_path, original_path, synced_at`;

export function getCachedRoomEvent(eventId: string): CachedRoomEvent | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(`SELECT ${ALL_COLUMNS} FROM room_events_cache WHERE id = ?`)
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

	let sql = `SELECT ${ALL_COLUMNS}
		FROM room_events_cache
		WHERE ${conditions.join(" AND ")}
		ORDER BY timestamp_ms DESC`;

	if (params.limit !== undefined) {
		sql += ` LIMIT ${params.limit}`;
	}

	const rows = db.prepare(sql).all(...args) as CachedRoomEventRow[];
	return rows.map(rowToEvent);
}

export function listCachedRoomEventsByProject(params: {
	project: string;
	excludeAuthorId?: string;
	startDate?: number;
	endDate?: number;
	limit?: number;
}): CachedRoomEvent[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();

	const conditions: string[] = ["project = ?"];
	const args: (string | number)[] = [params.project];

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

	let sql = `SELECT ${ALL_COLUMNS}
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
		`INSERT INTO room_events_cache (
			id, room_id, author_user_id, author_username, timestamp_ms, end_timestamp_ms,
			project, category, caption, project_progress, app_bundle_id, app_name, window_title,
			content_kind, content_title, thumbnail_path, original_path, synced_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			room_id = excluded.room_id,
			author_user_id = excluded.author_user_id,
			author_username = excluded.author_username,
			timestamp_ms = excluded.timestamp_ms,
			end_timestamp_ms = excluded.end_timestamp_ms,
			project = excluded.project,
			category = excluded.category,
			caption = excluded.caption,
			project_progress = excluded.project_progress,
			app_bundle_id = excluded.app_bundle_id,
			app_name = excluded.app_name,
			window_title = excluded.window_title,
			content_kind = excluded.content_kind,
			content_title = excluded.content_title,
			thumbnail_path = excluded.thumbnail_path,
			original_path = excluded.original_path,
			synced_at = excluded.synced_at`,
	).run(
		event.id,
		event.roomId,
		event.authorUserId,
		event.authorUsername,
		event.timestampMs,
		event.endTimestampMs,
		event.project,
		event.category,
		event.caption,
		event.projectProgress,
		event.appBundleId,
		event.appName,
		event.windowTitle,
		event.contentKind,
		event.contentTitle,
		event.thumbnailPath,
		event.originalPath,
		event.syncedAt,
	);
}

export function upsertCachedRoomEventsBatch(events: CachedRoomEvent[]): void {
	if (!isDbOpen()) return;
	if (events.length === 0) return;
	const db = getDatabase();
	const stmt = db.prepare(
		`INSERT INTO room_events_cache (
			id, room_id, author_user_id, author_username, timestamp_ms, end_timestamp_ms,
			project, category, caption, project_progress, app_bundle_id, app_name, window_title,
			content_kind, content_title, thumbnail_path, original_path, synced_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			room_id = excluded.room_id,
			author_user_id = excluded.author_user_id,
			author_username = excluded.author_username,
			timestamp_ms = excluded.timestamp_ms,
			end_timestamp_ms = excluded.end_timestamp_ms,
			project = excluded.project,
			category = excluded.category,
			caption = excluded.caption,
			project_progress = excluded.project_progress,
			app_bundle_id = excluded.app_bundle_id,
			app_name = excluded.app_name,
			window_title = excluded.window_title,
			content_kind = excluded.content_kind,
			content_title = excluded.content_title,
			thumbnail_path = excluded.thumbnail_path,
			original_path = excluded.original_path,
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
				event.endTimestampMs,
				event.project,
				event.category,
				event.caption,
				event.projectProgress,
				event.appBundleId,
				event.appName,
				event.windowTitle,
				event.contentKind,
				event.contentTitle,
				event.thumbnailPath,
				event.originalPath,
				event.syncedAt,
			);
		}
	})();
}

export function updateCachedEventImagePath(
	eventId: string,
	thumbnailPath: string,
	originalPath: string,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		"UPDATE room_events_cache SET thumbnail_path = ?, original_path = ? WHERE id = ?",
	).run(thumbnailPath, originalPath, eventId);
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
