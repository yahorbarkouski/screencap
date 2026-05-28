import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";

let db: Database.Database | null = null;

function openDb(): Database.Database {
	db = new Database(":memory:");
	return db;
}

afterEach(() => {
	db?.close();
	db = null;
});

describe("runMigrations", () => {
	it("removes deleted social, mobile, chat, sharing, and reminder storage", () => {
		const database = openDb();

		database.exec(`
			CREATE TABLE events (
				id TEXT PRIMARY KEY,
				timestamp INTEGER NOT NULL,
				app_bundle_id TEXT,
				shared_to_friends INTEGER DEFAULT 0
			);

			CREATE TABLE memory (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				content TEXT NOT NULL
			);

			CREATE TABLE project_shares (id TEXT);
			CREATE TABLE project_room_links (id TEXT);
			CREATE TABLE room_keys_cache (id TEXT);
			CREATE TABLE social_account (id TEXT);
			CREATE TABLE friends_cache (id TEXT);
			CREATE TABLE room_memberships (id TEXT);
			CREATE TABLE room_events_cache (id TEXT);
			CREATE TABLE room_day_wrapped_cache (id TEXT);
			CREATE TABLE mobile_activity_days_cache (id TEXT);
			CREATE TABLE mobile_paired_devices (id TEXT);
			CREATE TABLE room_members_cache (id TEXT);
			CREATE TABLE chat_threads_cache (id TEXT);
			CREATE TABLE chat_messages_cache (id TEXT);
			CREATE TABLE chat_unread_state (id TEXT);
			CREATE TABLE room_invites_sent (id TEXT);
			CREATE TABLE reminders (id TEXT);
		`);

		runMigrations(database);

		const eventColumns = database
			.prepare("PRAGMA table_info(events)")
			.all() as Array<{ name: string }>;
		expect(eventColumns.map((column) => column.name)).not.toContain(
			"shared_to_friends",
		);

		const removedTables = database
			.prepare(
				`
				SELECT name
				FROM sqlite_master
				WHERE type = 'table'
				  AND name IN (
					'project_shares',
					'project_room_links',
					'room_keys_cache',
					'social_account',
					'friends_cache',
					'room_memberships',
					'room_events_cache',
					'room_day_wrapped_cache',
					'mobile_activity_days_cache',
					'mobile_paired_devices',
					'room_members_cache',
					'chat_threads_cache',
					'chat_messages_cache',
					'chat_unread_state',
					'room_invites_sent',
					'reminders'
				  )
			`,
			)
			.all();

		expect(removedTables).toEqual([]);
	});
});
