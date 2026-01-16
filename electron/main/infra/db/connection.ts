import Database from "better-sqlite3";
import { createLogger } from "../log";
import { getDbPath } from "../paths";

const logger = createLogger({ scope: "Database" });

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
	if (!db || !db.open) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return db;
}

export function getDatabaseOrNull(): Database.Database | null {
	return db?.open ? db : null;
}

export function isDbOpen(): boolean {
	return db?.open ?? false;
}

export function openDatabase(): Database.Database {
	if (db?.open) {
		return db;
	}

	const dbPath = getDbPath();
	logger.info("Opening database at:", dbPath);
	db = new Database(dbPath);
	db.pragma("foreign_keys = ON");
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	return db;
}

export function closeDatabase(): void {
	if (db?.open) {
		logger.info("Closing database");
		db.close();
	}
	db = null;
}
