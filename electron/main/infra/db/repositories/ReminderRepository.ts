import type {
	GetRemindersOptions,
	Reminder,
	ReminderInput,
	ReminderUpdate,
} from "../../../../shared/types";
import { getDatabase, isDbOpen } from "../connection";
import { transformRow, transformRows } from "../transformers";

type RawReminderRow = Record<string, unknown>;

export function getReminders(options?: GetRemindersOptions): Reminder[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (options?.status) {
		conditions.push("status = ?");
		params.push(options.status);
	}

	if (!options?.includeNotes) {
		conditions.push("remind_at IS NOT NULL");
	}

	const whereClause =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limitClause =
		options?.limit !== undefined ? `LIMIT ${options.limit}` : "";
	const offsetClause =
		options?.offset !== undefined ? `OFFSET ${options.offset}` : "";

	const query = `
		SELECT * FROM reminders
		${whereClause}
		ORDER BY 
			CASE WHEN remind_at IS NULL THEN 1 ELSE 0 END,
			remind_at ASC,
			created_at DESC
		${limitClause} ${offsetClause}
	`;

	const rows = db.prepare(query).all(...params) as RawReminderRow[];
	return transformRows<Reminder>(rows);
}

export function getReminderById(id: string): Reminder | null {
	if (!isDbOpen()) return null;

	const db = getDatabase();
	const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as
		| RawReminderRow
		| undefined;

	if (!row) return null;
	return transformRow<Reminder>(row);
}

export function insertReminder(input: ReminderInput): Reminder {
	const db = getDatabase();
	const now = Date.now();

	db.prepare(`
		INSERT INTO reminders (
			id, title, body, source_text, remind_at, status,
			created_at, updated_at, thumbnail_path, original_path,
			app_bundle_id, window_title, url_host, content_kind, context_json
		) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		input.id,
		input.title,
		input.body ?? null,
		input.sourceText ?? null,
		input.remindAt ?? null,
		now,
		now,
		input.thumbnailPath ?? null,
		input.originalPath ?? null,
		input.appBundleId ?? null,
		input.windowTitle ?? null,
		input.urlHost ?? null,
		input.contentKind ?? null,
		input.contextJson ?? null,
	);

	return getReminderById(input.id) as Reminder;
}

export function updateReminder(id: string, updates: ReminderUpdate): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	const sets: string[] = ["updated_at = ?"];
	const params: unknown[] = [Date.now()];

	if (updates.title !== undefined) {
		sets.push("title = ?");
		params.push(updates.title);
	}

	if (updates.body !== undefined) {
		sets.push("body = ?");
		params.push(updates.body);
	}

	if (updates.remindAt !== undefined) {
		sets.push("remind_at = ?");
		params.push(updates.remindAt);
	}

	if (updates.status !== undefined) {
		sets.push("status = ?");
		params.push(updates.status);
	}

	params.push(id);

	db.prepare(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ?`).run(
		...params,
	);
}

export function deleteReminder(id: string): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
}

export function markReminderTriggered(id: string): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	const now = Date.now();
	db.prepare(
		"UPDATE reminders SET status = 'triggered', triggered_at = ?, updated_at = ? WHERE id = ?",
	).run(now, now, id);
}

export function markReminderCompleted(id: string): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	const now = Date.now();
	db.prepare(
		"UPDATE reminders SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
	).run(now, now, id);
}

export function getDueReminders(): Reminder[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const now = Date.now();

	const rows = db
		.prepare(
			`SELECT * FROM reminders 
			WHERE status = 'pending' 
			AND remind_at IS NOT NULL 
			AND remind_at <= ?
			ORDER BY remind_at ASC`,
		)
		.all(now) as RawReminderRow[];

	return transformRows<Reminder>(rows);
}

export function getUpcomingReminders(limit = 10): Reminder[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const now = Date.now();

	const rows = db
		.prepare(
			`SELECT * FROM reminders 
			WHERE status = 'pending' 
			AND remind_at IS NOT NULL 
			AND remind_at > ?
			ORDER BY remind_at ASC
			LIMIT ?`,
		)
		.all(now, limit) as RawReminderRow[];

	return transformRows<Reminder>(rows);
}

export function getNotes(limit = 50): Reminder[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();

	const rows = db
		.prepare(
			`SELECT * FROM reminders 
			WHERE remind_at IS NULL
			ORDER BY created_at DESC
			LIMIT ?`,
		)
		.all(limit) as RawReminderRow[];

	return transformRows<Reminder>(rows);
}
