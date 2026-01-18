import type Database from "better-sqlite3";
import { SELF_APP_BUNDLE_ID } from "../../../shared/appIdentity";
import { createLogger } from "../log";

const logger = createLogger({ scope: "Migrations" });

type TableInfoRow = { name: string };

function getExistingColumns(db: Database.Database, table: string): Set<string> {
	const rows = db
		.prepare(`PRAGMA table_info(${table})`)
		.all() as TableInfoRow[];
	return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(
	db: Database.Database,
	table: string,
	column: string,
	definition: string,
	existing: Set<string>,
): boolean {
	if (existing.has(column)) return false;
	db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
	logger.info(`Added column ${column} to ${table}`);
	return true;
}

function migrateQueue(db: Database.Database): void {
	const queueColumns = getExistingColumns(db, "queue");
	if (queueColumns.size === 0) return;

	const hasImageData = queueColumns.has("image_data");
	if (hasImageData) {
		db.transaction(() => {
			db.exec("DROP TABLE IF EXISTS queue_v2");
			db.exec(`
        CREATE TABLE queue_v2 (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          attempts INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          next_attempt_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
      `);
			db.exec(`
        INSERT INTO queue_v2 (id, event_id, attempts, created_at, next_attempt_at)
        SELECT id, event_id, attempts, created_at, created_at
        FROM queue;
      `);
			db.exec("DROP TABLE queue");
			db.exec("ALTER TABLE queue_v2 RENAME TO queue");
		})();
		logger.info("Migrated queue table to drop image_data");
		return;
	}

	const changed = addColumnIfMissing(
		db,
		"queue",
		"next_attempt_at",
		"INTEGER NOT NULL DEFAULT 0",
		queueColumns,
	);

	if (changed) {
		db.exec(
			"UPDATE queue SET next_attempt_at = created_at WHERE next_attempt_at = 0",
		);
	}
}

export function runMigrations(db: Database.Database): void {
	logger.info("Running migrations");

	const eventsColumns = getExistingColumns(db, "events");

	addColumnIfMissing(
		db,
		"events",
		"addiction_candidate",
		"TEXT",
		eventsColumns,
	);
	addColumnIfMissing(
		db,
		"events",
		"addiction_confidence",
		"REAL",
		eventsColumns,
	);
	addColumnIfMissing(db, "events", "addiction_prompt", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "end_timestamp", "INTEGER", eventsColumns);
	addColumnIfMissing(db, "events", "stable_hash", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "detail_hash", "TEXT", eventsColumns);
	addColumnIfMissing(
		db,
		"events",
		"merged_count",
		"INTEGER DEFAULT 1",
		eventsColumns,
	);
	addColumnIfMissing(
		db,
		"events",
		"project_progress",
		"INTEGER DEFAULT 0",
		eventsColumns,
	);
	addColumnIfMissing(
		db,
		"events",
		"project_progress_confidence",
		"REAL",
		eventsColumns,
	);
	addColumnIfMissing(
		db,
		"events",
		"project_progress_evidence",
		"TEXT",
		eventsColumns,
	);

	addColumnIfMissing(db, "events", "app_bundle_id", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "app_name", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "window_title", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "url_host", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "url_canonical", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "content_kind", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "content_id", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "content_title", "TEXT", eventsColumns);
	addColumnIfMissing(
		db,
		"events",
		"is_fullscreen",
		"INTEGER DEFAULT 0",
		eventsColumns,
	);
	addColumnIfMissing(db, "events", "context_provider", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "context_confidence", "REAL", eventsColumns);
	addColumnIfMissing(db, "events", "context_key", "TEXT", eventsColumns);
	addColumnIfMissing(db, "events", "context_json", "TEXT", eventsColumns);
	addColumnIfMissing(
		db,
		"events",
		"potential_progress",
		"INTEGER DEFAULT 0",
		eventsColumns,
	);
	addColumnIfMissing(
		db,
		"events",
		"shared_to_friends",
		"INTEGER DEFAULT 0",
		eventsColumns,
	);

	db.exec(
		"UPDATE events SET end_timestamp = timestamp WHERE end_timestamp IS NULL",
	);
	db.exec("UPDATE events SET merged_count = 1 WHERE merged_count IS NULL");
	db.exec(
		"UPDATE events SET project_progress = 0 WHERE project_progress IS NULL",
	);

	const clearedAddictionSignals = db
		.prepare(
			`
      UPDATE events
      SET
        tracked_addiction = NULL,
        addiction_candidate = NULL,
        addiction_confidence = NULL,
        addiction_prompt = NULL
      WHERE app_bundle_id = ?
        AND (
          tracked_addiction IS NOT NULL OR
          addiction_candidate IS NOT NULL OR
          addiction_confidence IS NOT NULL OR
          addiction_prompt IS NOT NULL
        )
    `,
		)
		.run(SELF_APP_BUNDLE_ID).changes;
	if (clearedAddictionSignals > 0) {
		logger.info(
			`Cleared addiction signals for ${clearedAddictionSignals} self captures`,
		);
	}

	const memoryColumns = getExistingColumns(db, "memory");
	addColumnIfMissing(db, "memory", "description", "TEXT", memoryColumns);

	migrateQueue(db);
	migrateRoomTables(db);
	migrateRemindersTable(db);

	logger.info("Migrations complete");
}

function tableExists(db: Database.Database, table: string): boolean {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(table) as { name: string } | undefined;
	return row !== undefined;
}

function migrateRoomTables(db: Database.Database): void {
	if (!tableExists(db, "room_memberships")) {
		db.exec(`
			CREATE TABLE room_memberships (
				room_id TEXT PRIMARY KEY,
				room_name TEXT NOT NULL,
				role TEXT NOT NULL,
				owner_user_id TEXT NOT NULL,
				owner_username TEXT NOT NULL,
				joined_at INTEGER NOT NULL,
				last_synced_at INTEGER
			)
		`);
		db.exec("CREATE INDEX idx_room_memberships_role ON room_memberships(role)");
		logger.info("Created room_memberships table");
	}

	if (!tableExists(db, "room_members_cache")) {
		db.exec(`
			CREATE TABLE room_members_cache (
				room_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				username TEXT NOT NULL,
				role TEXT NOT NULL,
				PRIMARY KEY(room_id, user_id)
			)
		`);
		logger.info("Created room_members_cache table");
	}

	if (tableExists(db, "room_events_cache")) {
		const columns = getExistingColumns(db, "room_events_cache");
		if (columns.has("payload_ciphertext") || !columns.has("project")) {
			db.exec("DROP TABLE room_events_cache");
			logger.info(
				"Dropped old room_events_cache table for full event schema migration",
			);
		}
	}

	if (!tableExists(db, "room_events_cache")) {
		db.exec(`
			CREATE TABLE room_events_cache (
				id TEXT PRIMARY KEY,
				room_id TEXT NOT NULL,
				author_user_id TEXT NOT NULL,
				author_username TEXT NOT NULL,
				timestamp_ms INTEGER NOT NULL,
				end_timestamp_ms INTEGER,
				project TEXT,
				category TEXT,
				caption TEXT,
				project_progress INTEGER DEFAULT 0,
				app_bundle_id TEXT,
				app_name TEXT,
				window_title TEXT,
				content_kind TEXT,
				content_title TEXT,
				thumbnail_path TEXT,
				original_path TEXT,
				synced_at INTEGER NOT NULL
			)
		`);
		db.exec(
			"CREATE INDEX idx_room_events_cache_room_timestamp ON room_events_cache(room_id, timestamp_ms)",
		);
		db.exec(
			"CREATE INDEX idx_room_events_cache_author ON room_events_cache(author_user_id)",
		);
		db.exec(
			"CREATE INDEX idx_room_events_cache_project ON room_events_cache(project)",
		);
		logger.info("Created room_events_cache table with full event schema");
	}

	const columns = getExistingColumns(db, "room_events_cache");
	addColumnIfMissing(db, "room_events_cache", "url", "TEXT", columns);
	addColumnIfMissing(
		db,
		"room_events_cache",
		"background_context",
		"TEXT",
		columns,
	);
}

function migrateRemindersTable(db: Database.Database): void {
	if (!tableExists(db, "reminders")) {
		db.exec(`
			CREATE TABLE reminders (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				body TEXT,
				source_text TEXT,
				remind_at INTEGER,
				status TEXT NOT NULL DEFAULT 'pending',
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				triggered_at INTEGER,
				completed_at INTEGER,
				thumbnail_path TEXT,
				original_path TEXT,
				app_bundle_id TEXT,
				window_title TEXT,
				url_host TEXT,
				content_kind TEXT,
				context_json TEXT
			)
		`);
		db.exec("CREATE INDEX idx_reminders_remind_at ON reminders(remind_at)");
		db.exec("CREATE INDEX idx_reminders_status ON reminders(status)");
		db.exec("CREATE INDEX idx_reminders_created_at ON reminders(created_at)");
		logger.info("Created reminders table");
	}
}
