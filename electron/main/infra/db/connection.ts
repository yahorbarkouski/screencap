import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { createLogger } from "../log";
import { createPerfTracker } from "../log/perf";
import { getDbPath } from "../paths";

const logger = createLogger({ scope: "Database" });
const perf = createPerfTracker("db");
const SQL_REPORT_MS = 60_000;
const SQL_LIMIT = 15;
const sqlStats = new Map<
	string,
	{ prepareCount: number; execCount: number; totalMs: number; maxMs: number }
>();
let lastSqlReportAt = performance.now();

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
	instrumentDatabase(db);
	return db;
}

export function closeDatabase(): void {
	if (db?.open) {
		logger.info("Closing database");
		db.close();
	}
	db = null;
}

function instrumentDatabase(database: Database.Database): void {
	if (!perf.enabled) return;

	const originalPrepare = database.prepare.bind(database);

	database.prepare = ((sql: string) => {
		const prepareStart = performance.now();
		const stmt = originalPrepare(sql);
		perf.track("db.prepare", performance.now() - prepareStart);
		recordSqlPrepare(sql);
		return instrumentStatement(stmt, sql);
	}) as Database.Database["prepare"];
}

function instrumentStatement<T extends Database.Statement>(stmt: T, sql: string): T {
	const wrap = (method: "run" | "get" | "all") => {
		const original = (stmt as Record<string, unknown>)[method];
		if (typeof original !== "function") return;
		(stmt as Record<string, unknown>)[method] = (...args: unknown[]) => {
			const start = performance.now();
			const result = (original as (...args: unknown[]) => unknown).apply(
				stmt,
				args,
			);
			const elapsed = performance.now() - start;
			perf.track(`db.${method}`, elapsed);
			recordSqlExec(sql, elapsed);
			return result;
		};
	};

	wrap("run");
	wrap("get");
	wrap("all");

	return stmt;
}

function recordSqlPrepare(sql: string): void {
	if (!perf.enabled) return;
	const entry = sqlStats.get(sql) ?? {
		prepareCount: 0,
		execCount: 0,
		totalMs: 0,
		maxMs: 0,
	};
	entry.prepareCount += 1;
	sqlStats.set(sql, entry);
	maybeReportSql();
}

function recordSqlExec(sql: string, elapsed: number): void {
	if (!perf.enabled) return;
	const entry = sqlStats.get(sql) ?? {
		prepareCount: 0,
		execCount: 0,
		totalMs: 0,
		maxMs: 0,
	};
	entry.execCount += 1;
	entry.totalMs += elapsed;
	entry.maxMs = Math.max(entry.maxMs, elapsed);
	sqlStats.set(sql, entry);
	maybeReportSql();
}

function maybeReportSql(): void {
	const now = performance.now();
	if (now - lastSqlReportAt < SQL_REPORT_MS) return;
	const entries = Array.from(sqlStats.entries()).map(([sql, stat]) => ({
		sql: truncateSql(sql),
		prepareCount: stat.prepareCount,
		execCount: stat.execCount,
		totalMs: Math.round(stat.totalMs),
		maxMs: Math.round(stat.maxMs),
	}));
	const topPrepare = [...entries]
		.sort((a, b) => b.prepareCount - a.prepareCount)
		.slice(0, SQL_LIMIT);
	const topExec = [...entries]
		.sort((a, b) => b.execCount - a.execCount)
		.slice(0, SQL_LIMIT);
	const topTotal = [...entries]
		.sort((a, b) => b.totalMs - a.totalMs)
		.slice(0, SQL_LIMIT);
	logger.info("DB SQL stats", {
		windowMs: Math.round(now - lastSqlReportAt),
		topPrepare,
		topExec,
		topTotal,
	});
	sqlStats.clear();
	lastSqlReportAt = now;
}

function truncateSql(sql: string): string {
	if (sql.length <= 240) return sql;
	return `${sql.slice(0, 237)}...`;
}
