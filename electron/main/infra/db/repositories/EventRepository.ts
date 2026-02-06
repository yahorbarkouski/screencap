import { existsSync, unlinkSync } from "node:fs";
import type {
	Event,
	GetEventsOptions,
	LatestEventByDisplayId,
} from "../../../../shared/types";
import { canonicalizeProject } from "../../../features/projects/ProjectNormalizer";
import { createLogger } from "../../log";
import { getDatabase, isDbOpen } from "../connection";
import { toSnakeCase, transformRow, transformRows } from "../transformers";
import {
	deleteEventScreenshots,
	getEventScreenshotPaths,
} from "./EventScreenshotRepository";

const logger = createLogger({ scope: "EventRepository" });

type RawEventRow = Record<string, unknown>;

function highResPathFromLowResPath(
	path: string | null | undefined,
): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

function safeUnlink(
	path: string | null | undefined,
	context: { id: string; kind: string },
): void {
	if (!path) return;
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		logger.warn(`Failed to delete ${context.kind} file`, {
			id: context.id,
			path,
		});
	}
}

export function insertEvent(event: Partial<Event>): void {
	if (!isDbOpen()) {
		logger.error("Cannot insert event - database not open");
		return;
	}

	const db = getDatabase();
	logger.debug("Inserting event:", { id: event.id });

	const stmt = db.prepare(`
    INSERT INTO events (
      id, timestamp, end_timestamp, display_id, category, subcategories, 
      project, project_progress, project_progress_confidence, project_progress_evidence, potential_progress,
      tags, confidence, caption, tracked_addiction, 
      addiction_candidate, addiction_confidence, addiction_prompt,
      thumbnail_path, original_path, stable_hash, detail_hash, 
      merged_count, dismissed, user_label, status,
      app_bundle_id, app_name, window_title, url_host, url_canonical,
      content_kind, content_id, content_title, is_fullscreen,
      context_provider, context_confidence, context_key, context_json, shared_to_friends
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	stmt.run(
		event.id,
		event.timestamp,
		event.endTimestamp ?? event.timestamp,
		event.displayId ?? null,
		event.category ?? null,
		event.subcategories ?? null,
		event.project ?? null,
		event.projectProgress ?? 0,
		event.projectProgressConfidence ?? null,
		event.projectProgressEvidence ?? null,
		event.potentialProgress ?? 0,
		event.tags ?? null,
		event.confidence ?? null,
		event.caption ?? null,
		event.trackedAddiction ?? null,
		event.addictionCandidate ?? null,
		event.addictionConfidence ?? null,
		event.addictionPrompt ?? null,
		event.thumbnailPath ?? null,
		event.originalPath ?? null,
		event.stableHash ?? null,
		event.detailHash ?? null,
		event.mergedCount ?? 1,
		event.dismissed ?? 0,
		event.userLabel ?? null,
		event.status ?? "pending",
		event.appBundleId ?? null,
		event.appName ?? null,
		event.windowTitle ?? null,
		event.urlHost ?? null,
		event.urlCanonical ?? null,
		event.contentKind ?? null,
		event.contentId ?? null,
		event.contentTitle ?? null,
		event.isFullscreen ?? 0,
		event.contextProvider ?? null,
		event.contextConfidence ?? null,
		event.contextKey ?? null,
		event.contextJson ?? null,
		event.sharedToFriends ?? 0,
	);
}

export function getEventById(id: string): Event | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare(`
    SELECT
      e.*,
      f.path AS favicon_path,
      ai.path AS app_icon_path,
      (SELECT COUNT(*) FROM event_screenshots es WHERE es.event_id = e.id) AS screenshot_count
    FROM events e
    LEFT JOIN favicons f ON f.host = e.url_host
    LEFT JOIN app_icons ai ON ai.bundle_id = e.app_bundle_id
    WHERE e.id = ?
  `)
		.get(id) as RawEventRow | undefined;
	return row ? transformRow<Event>(row) : null;
}

export function getEvents(options: GetEventsOptions): Event[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const conditions: string[] = ["1=1"];
	const params: unknown[] = [];

	if (options.category) {
		conditions.push("e.category = ?");
		params.push(options.category);
	}

	if (options.project) {
		conditions.push("e.project = ?");
		params.push(options.project);
	}

	if (options.projectProgress !== undefined) {
		conditions.push("e.project_progress = ?");
		params.push(options.projectProgress ? 1 : 0);
	}

	if (options.trackedAddiction) {
		conditions.push("e.tracked_addiction = ?");
		params.push(options.trackedAddiction);
	}

	if (options.hasTrackedAddiction !== undefined) {
		conditions.push(
			options.hasTrackedAddiction
				? "e.tracked_addiction IS NOT NULL"
				: "e.tracked_addiction IS NULL",
		);
	}

	if (options.appBundleId) {
		conditions.push("e.app_bundle_id = ?");
		params.push(options.appBundleId);
	}

	if (options.urlHost) {
		conditions.push("e.url_host = ?");
		params.push(options.urlHost);
	}

	if (options.startDate) {
		conditions.push("e.timestamp >= ?");
		params.push(options.startDate);
	}

	if (options.endDate) {
		conditions.push("e.timestamp <= ?");
		params.push(options.endDate);
	}

	if (options.search) {
		conditions.push("(e.caption LIKE ? OR e.tags LIKE ?)");
		params.push(`%${options.search}%`, `%${options.search}%`);
	}

	if (options.dismissed === undefined) {
		conditions.push("e.dismissed = 0");
	} else {
		conditions.push("e.dismissed = ?");
		params.push(options.dismissed ? 1 : 0);
	}

	let query = `
    SELECT
      e.*,
      f.path AS favicon_path,
      ai.path AS app_icon_path,
      (SELECT COUNT(*) FROM event_screenshots es WHERE es.event_id = e.id) AS screenshot_count
    FROM events e
    LEFT JOIN favicons f ON f.host = e.url_host
    LEFT JOIN app_icons ai ON ai.bundle_id = e.app_bundle_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY e.timestamp DESC
  `;

	if (options.limit) {
		query += " LIMIT ?";
		params.push(options.limit);
	}

	if (options.offset) {
		query += " OFFSET ?";
		params.push(options.offset);
	}

	const rows = db.prepare(query).all(...params) as RawEventRow[];
	return transformRows<Event>(rows);
}

export function listExpiredEventIds(
	cutoffTimestamp: number,
	limit: number,
): string[] {
	if (!isDbOpen()) return [];
	if (limit <= 0) return [];

	const db = getDatabase();
	const rows = db
		.prepare(
			`
      SELECT id
      FROM events
      WHERE COALESCE(end_timestamp, timestamp) < ?
      ORDER BY timestamp ASC
      LIMIT ?
    `,
		)
		.all(cutoffTimestamp, limit) as Array<{ id: string }>;

	return rows.map((r) => r.id);
}

export interface HqCleanupCutoffs {
	regularCutoff: number;
	sharedCutoff: number;
	progressCutoff: number;
	progressFallbackCutoff: number;
	eodBufferMs: number;
}

export interface HqCleanupCursor {
	timestamp: number;
	id: string;
}

export function listHqCleanupCandidates(
	cutoffs: HqCleanupCutoffs,
	limit: number,
	cursor?: HqCleanupCursor,
): Array<{ id: string; originalPath: string; timestamp: number }> {
	if (!isDbOpen()) return [];
	if (limit <= 0) return [];

	const db = getDatabase();
	const now = Date.now();
	const eodSubmittedBefore = now - cutoffs.eodBufferMs;
	const cursorClause = cursor
		? "AND (e.timestamp > ? OR (e.timestamp = ? AND e.id > ?))"
		: "";

	const rows = db
		.prepare(
			`
      SELECT e.id, e.original_path, e.timestamp
      FROM events e
      WHERE e.original_path IS NOT NULL
        AND (
          -- Tier 1: Regular events (not progress, not shared)
          (e.project_progress = 0 AND e.shared_to_friends = 0 
           AND COALESCE(e.end_timestamp, e.timestamp) < ?)
          OR
          -- Tier 2: Shared events (longer cutoff, image already uploaded)
          (e.shared_to_friends = 1 
           AND COALESCE(e.end_timestamp, e.timestamp) < ?)
          OR
          -- Tier 3a: Progress events with EOD submitted + buffer
          (e.project_progress = 1 AND e.shared_to_friends = 0
           AND COALESCE(e.end_timestamp, e.timestamp) < ?
           AND EXISTS (
             SELECT 1 FROM eod_entries eod
             WHERE eod.submitted_at IS NOT NULL
               AND eod.submitted_at < ?
               AND eod.day_start <= e.timestamp
               AND e.timestamp <= eod.day_end
           ))
          OR
          -- Tier 3b: Progress events fallback (older than 7 days, no EOD needed)
          (e.project_progress = 1 
           AND COALESCE(e.end_timestamp, e.timestamp) < ?)
        )
      ${cursorClause}
      ORDER BY e.timestamp ASC
      LIMIT ?
    `,
		)
		.all(
			...[
				cutoffs.regularCutoff,
				cutoffs.sharedCutoff,
				cutoffs.progressCutoff,
				eodSubmittedBefore,
				cutoffs.progressFallbackCutoff,
				...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.id] : []),
				limit,
			],
		) as Array<{
		id: string;
		original_path: string;
		timestamp: number;
	}>;

	return rows.map((r) => ({
		id: r.id,
		originalPath: r.original_path,
		timestamp: r.timestamp,
	}));
}

export function cleanupQueueForCompletedEvents(): number {
	if (!isDbOpen()) return 0;
	const db = getDatabase();
	const result = db
		.prepare(
			`
      DELETE FROM queue
      WHERE event_id IN (SELECT id FROM events WHERE status = 'completed')
    `,
		)
		.run();
	return result.changes;
}

export function recoverInterruptedEventProcessing(now = Date.now()): number {
	if (!isDbOpen()) return 0;
	const db = getDatabase();
	const tx = db.transaction((ts: number) => {
		db.prepare(
			`
        UPDATE queue
        SET next_attempt_at = ?
        WHERE event_id IN (SELECT id FROM events WHERE status = 'processing')
      `,
		).run(ts);
		const result = db
			.prepare(
				"UPDATE events SET status = 'failed' WHERE status = 'processing'",
			)
			.run();
		return result.changes;
	});
	return tx(now);
}

export function listPendingEventIdsMissingQueue(limit: number): string[] {
	if (!isDbOpen()) return [];
	if (limit <= 0) return [];
	const db = getDatabase();
	const rows = db
		.prepare(
			`
      SELECT e.id
      FROM events e
      WHERE e.dismissed = 0
        AND e.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM queue q WHERE q.event_id = e.id)
      ORDER BY e.timestamp DESC
      LIMIT ?
    `,
		)
		.all(limit) as Array<{ id: string }>;
	return rows.map((r) => r.id);
}

export function updateEvent(id: string, updates: Partial<Event>): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	const fields = Object.keys(updates)
		.map((key) => `${toSnakeCase(key)} = ?`)
		.join(", ");
	const values = Object.values(updates);

	db.prepare(`UPDATE events SET ${fields} WHERE id = ?`).run(...values, id);
}

export function dismissEvents(ids: string[]): void {
	if (!isDbOpen() || ids.length === 0) return;

	const db = getDatabase();
	const placeholders = ids.map(() => "?").join(",");
	db.prepare(
		`UPDATE events SET dismissed = 1 WHERE id IN (${placeholders})`,
	).run(...ids);
}

export function relabelEvents(ids: string[], label: string): void {
	if (!isDbOpen() || ids.length === 0) return;

	const db = getDatabase();
	const placeholders = ids.map(() => "?").join(",");
	db.prepare(
		`UPDATE events SET user_label = ?, confidence = 1 WHERE id IN (${placeholders})`,
	).run(label, ...ids);
}

export function confirmAddiction(ids: string[]): void {
	if (!isDbOpen() || ids.length === 0) return;

	const db = getDatabase();
	const placeholders = ids.map(() => "?").join(",");
	db.prepare(
		`UPDATE events SET tracked_addiction = addiction_candidate, addiction_candidate = NULL WHERE id IN (${placeholders})`,
	).run(...ids);
}

export function rejectAddiction(ids: string[]): void {
	if (!isDbOpen() || ids.length === 0) return;

	const db = getDatabase();
	const placeholders = ids.map(() => "?").join(",");
	db.prepare(
		`UPDATE events SET tracked_addiction = NULL, addiction_candidate = NULL WHERE id IN (${placeholders})`,
	).run(...ids);
}

export function deleteEvent(id: string): void {
	if (!isDbOpen()) return;

	const db = getDatabase();
	const event = db
		.prepare("SELECT thumbnail_path, original_path FROM events WHERE id = ?")
		.get(id) as
		| { thumbnail_path: string | null; original_path: string | null }
		| undefined;
	const screenshotFiles = getEventScreenshotPaths(id);

	const deleteTx = db.transaction((eventId: string) => {
		db.prepare("DELETE FROM queue WHERE event_id = ?").run(eventId);
		deleteEventScreenshots(eventId);
		db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
	});

	deleteTx(id);

	for (const file of screenshotFiles) {
		safeUnlink(file.thumbnailPath, { id, kind: "screenshot thumbnail" });
		safeUnlink(file.originalPath, { id, kind: "screenshot original" });
		safeUnlink(highResPathFromLowResPath(file.originalPath), {
			id,
			kind: "screenshot high-res",
		});
	}

	if (event?.thumbnail_path) {
		safeUnlink(event.thumbnail_path, { id, kind: "thumbnail" });
	}

	if (event?.original_path) {
		safeUnlink(event.original_path, { id, kind: "original" });
		safeUnlink(highResPathFromLowResPath(event.original_path), {
			id,
			kind: "high-res",
		});
	}
}

export function getLatestEventByDisplayId(
	displayId: string,
): LatestEventByDisplayId | null {
	if (!isDbOpen()) return null;

	const db = getDatabase();
	const row = db
		.prepare(`
    SELECT id, timestamp, end_timestamp, display_id, stable_hash, detail_hash, original_path, merged_count, context_key 
    FROM events 
    WHERE display_id = ? AND dismissed = 0
    ORDER BY timestamp DESC 
    LIMIT 1
  `)
		.get(displayId) as RawEventRow | undefined;

	return row ? transformRow<LatestEventByDisplayId>(row) : null;
}

export function getLatestCompletedEventByFingerprint(input: {
	stableHash: string;
	contextKey: string;
	excludeId?: string;
}): Event | null {
	if (!isDbOpen()) return null;

	const db = getDatabase();
	const params: unknown[] = [input.stableHash, input.contextKey];

	let query = `
    SELECT *
    FROM events
    WHERE stable_hash = ? AND context_key = ? AND status = 'completed' AND dismissed = 0
  `;

	if (input.excludeId) {
		query += " AND id <> ?";
		params.push(input.excludeId);
	}

	query += " ORDER BY timestamp DESC LIMIT 1";

	const row = db.prepare(query).get(...params) as RawEventRow | undefined;
	return row ? transformRow<Event>(row) : null;
}

export function getDistinctCategories(): string[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const rows = db
		.prepare("SELECT DISTINCT category FROM events WHERE category IS NOT NULL")
		.all() as { category: string }[];
	return rows.map((r) => r.category);
}

export function getDistinctProjects(): string[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const rows = db
		.prepare(
			`SELECT DISTINCT name FROM (
				SELECT project AS name FROM events WHERE project IS NOT NULL
				UNION
				SELECT content AS name FROM memory WHERE type = 'project'
			) ORDER BY name COLLATE NOCASE ASC`,
		)
		.all() as { name: string }[];
	return rows.map((r) => r.name);
}

export function getEarliestEventTimestampForProject(
	project: string,
): number | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare("SELECT MIN(timestamp) AS ts FROM events WHERE project = ?")
		.get(project) as { ts: number | null } | undefined;
	return row?.ts ?? null;
}

type DistinctFacetOptions = {
	startDate?: number;
	endDate?: number;
	dismissed?: boolean;
};

export function getDistinctProjectsInRange(
	options: DistinctFacetOptions,
): string[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const conditions: string[] = ["e.project IS NOT NULL"];
	const params: unknown[] = [];

	if (options.startDate != null) {
		conditions.push("e.timestamp >= ?");
		params.push(options.startDate);
	}

	if (options.endDate != null) {
		conditions.push("e.timestamp <= ?");
		params.push(options.endDate);
	}

	if (options.dismissed === undefined) {
		conditions.push("e.dismissed = 0");
	} else {
		conditions.push("e.dismissed = ?");
		params.push(options.dismissed ? 1 : 0);
	}

	const rows = db
		.prepare(
			`
      SELECT DISTINCT e.project AS project
      FROM events e
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.project COLLATE NOCASE ASC
    `,
		)
		.all(...params) as { project: string }[];

	return rows.map((r) => r.project);
}

export function getCategoryStats(
	startDate: number,
	endDate: number,
): { category: string; count: number }[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	return db
		.prepare(`
    SELECT category, COUNT(*) as count 
    FROM events 
    WHERE timestamp >= ? AND timestamp <= ? AND dismissed = 0
    GROUP BY category
  `)
		.all(startDate, endDate) as { category: string; count: number }[];
}

export function getProjectCounts(): { project: string; count: number }[] {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	return db
		.prepare(
			"SELECT project, COUNT(*) as count FROM events WHERE project IS NOT NULL GROUP BY project",
		)
		.all() as { project: string; count: number }[];
}

export function updateProjectName(oldName: string, newName: string): number {
	if (!isDbOpen()) return 0;

	const db = getDatabase();
	const result = db
		.prepare("UPDATE events SET project = ? WHERE project = ?")
		.run(newName, oldName);
	return result.changes;
}

export function updateAddictionName(oldName: string, newName: string): number {
	if (!isDbOpen()) return 0;

	const db = getDatabase();
	const tracked = db
		.prepare(
			"UPDATE events SET tracked_addiction = ? WHERE tracked_addiction = ?",
		)
		.run(newName, oldName);
	const candidate = db
		.prepare(
			"UPDATE events SET addiction_candidate = ? WHERE addiction_candidate = ?",
		)
		.run(newName, oldName);
	return tracked.changes + candidate.changes;
}

export function getDistinctAppsInRange(options: DistinctFacetOptions): Array<{
	bundleId: string;
	name: string | null;
	appIconPath: string | null;
}> {
	if (!isDbOpen()) return [];

	const db = getDatabase();
	const conditions: string[] = ["e.app_bundle_id IS NOT NULL"];
	const params: unknown[] = [];

	if (options.startDate != null) {
		conditions.push("e.timestamp >= ?");
		params.push(options.startDate);
	}

	if (options.endDate != null) {
		conditions.push("e.timestamp <= ?");
		params.push(options.endDate);
	}

	if (options.dismissed === undefined) {
		conditions.push("e.dismissed = 0");
	} else {
		conditions.push("e.dismissed = ?");
		params.push(options.dismissed ? 1 : 0);
	}

	const rows = db
		.prepare(
			`
      SELECT
        e.app_bundle_id as bundleId,
        MAX(e.app_name) as name,
        MAX(ai.path) as app_icon_path
      FROM events e
      LEFT JOIN app_icons ai ON ai.bundle_id = e.app_bundle_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY e.app_bundle_id
      ORDER BY COALESCE(MAX(e.app_name), e.app_bundle_id) COLLATE NOCASE ASC
    `,
		)
		.all(...params) as Array<{
		bundleId: string;
		name: string | null;
		app_icon_path: string | null;
	}>;

	return rows.map((r) => ({
		bundleId: r.bundleId,
		name: r.name ?? null,
		appIconPath: r.app_icon_path ?? null,
	}));
}

export function getDistinctApps(): Array<{
	bundleId: string;
	name: string | null;
	appIconPath: string | null;
}> {
	return getDistinctAppsInRange({});
}

export interface AddictionStatsRow {
	name: string;
	lastIncidentAt: number | null;
	weekCount: number;
	prevWeekCount: number;
	coverOriginalPath: string | null;
	coverThumbnailPath: string | null;
}

export function getAddictionStatsBatch(
	names: string[],
): Record<string, AddictionStatsRow> {
	if (!isDbOpen() || names.length === 0) return {};

	const db = getDatabase();
	const now = Date.now();
	const weekMs = 7 * 24 * 60 * 60 * 1000;
	const weekStart = now - weekMs;
	const prevWeekStart = now - 2 * weekMs;

	const placeholders = names.map(() => "?").join(",");

	const rows = db
		.prepare(
			`
		SELECT
			e.tracked_addiction AS name,
			MAX(COALESCE(e.end_timestamp, e.timestamp)) AS last_incident_at,
			SUM(CASE WHEN e.timestamp >= ? AND e.timestamp <= ? THEN 1 ELSE 0 END) AS week_count,
			SUM(CASE WHEN e.timestamp >= ? AND e.timestamp < ? THEN 1 ELSE 0 END) AS prev_week_count
		FROM events e
		WHERE e.tracked_addiction IN (${placeholders})
		  AND e.dismissed = 0
		GROUP BY e.tracked_addiction
	`,
		)
		.all(weekStart, now, prevWeekStart, weekStart, ...names) as Array<{
		name: string;
		last_incident_at: number | null;
		week_count: number;
		prev_week_count: number;
	}>;

	const coverRows = db
		.prepare(
			`
		SELECT
			e.tracked_addiction AS name,
			e.original_path,
			e.thumbnail_path
		FROM events e
		WHERE e.id IN (
			SELECT id FROM (
				SELECT id, tracked_addiction,
					ROW_NUMBER() OVER (PARTITION BY tracked_addiction ORDER BY timestamp DESC) AS rn
				FROM events
				WHERE tracked_addiction IN (${placeholders}) AND dismissed = 0
			)
			WHERE rn = 1
		)
	`,
		)
		.all(...names) as Array<{
		name: string;
		original_path: string | null;
		thumbnail_path: string | null;
	}>;

	const coverMap = new Map(coverRows.map((r) => [r.name, r]));

	const result: Record<string, AddictionStatsRow> = {};
	for (const name of names) {
		const stats = rows.find((r) => r.name === name);
		const cover = coverMap.get(name);
		result[name] = {
			name,
			lastIncidentAt: stats?.last_incident_at ?? null,
			weekCount: stats?.week_count ?? 0,
			prevWeekCount: stats?.prev_week_count ?? 0,
			coverOriginalPath: cover?.original_path ?? null,
			coverThumbnailPath: cover?.thumbnail_path ?? null,
		};
	}

	return result;
}

export interface ProjectStatsRow {
	name: string;
	eventCount: number;
	lastEventAt: number | null;
	coverOriginalPath: string | null;
	coverThumbnailPath: string | null;
	coverProjectProgress: number;
}

export function getProjectStatsBatch(
	names: string[],
): Record<string, ProjectStatsRow> {
	if (!isDbOpen() || names.length === 0) return {};

	const canonicalizedNames = names.map((n) => canonicalizeProject(n) ?? n);
	const canonicalToOriginal = new Map<string, string>();
	for (let i = 0; i < names.length; i++) {
		canonicalToOriginal.set(canonicalizedNames[i], names[i]);
	}
	const uniqueCanonical = [...new Set(canonicalizedNames)];

	const db = getDatabase();
	const placeholders = uniqueCanonical.map(() => "?").join(",");

	const countRows = db
		.prepare(
			`
		SELECT
			e.project AS name,
			COUNT(*) AS event_count,
			MAX(e.timestamp) AS last_event_at
		FROM events e
		WHERE e.project IN (${placeholders})
		  AND e.dismissed = 0
		GROUP BY e.project
	`,
		)
		.all(...uniqueCanonical) as Array<{
		name: string;
		event_count: number;
		last_event_at: number | null;
	}>;

	const coverRows = db
		.prepare(
			`
		SELECT name, original_path, thumbnail_path, project_progress FROM (
			SELECT
				e.project AS name,
				e.original_path,
				e.thumbnail_path,
				e.project_progress,
				ROW_NUMBER() OVER (
					PARTITION BY e.project
					ORDER BY e.project_progress DESC, e.timestamp DESC
				) AS rn
			FROM events e
			WHERE e.project IN (${placeholders}) AND e.dismissed = 0
		)
		WHERE rn = 1
	`,
		)
		.all(...uniqueCanonical) as Array<{
		name: string;
		original_path: string | null;
		thumbnail_path: string | null;
		project_progress: number;
	}>;

	const coverMap = new Map(coverRows.map((r) => [r.name, r]));

	const result: Record<string, ProjectStatsRow> = {};
	for (const name of names) {
		const canonical = canonicalizeProject(name) ?? name;
		const stats = countRows.find((r) => r.name === canonical);
		const cover = coverMap.get(canonical);
		result[name] = {
			name,
			eventCount: stats?.event_count ?? 0,
			lastEventAt: stats?.last_event_at ?? null,
			coverOriginalPath: cover?.original_path ?? null,
			coverThumbnailPath: cover?.thumbnail_path ?? null,
			coverProjectProgress: cover?.project_progress ?? 0,
		};
	}

	return result;
}
