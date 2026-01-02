import type { RepoWorkSession } from "../../../../shared/types";
import { getDatabase, getDatabaseOrNull, isDbOpen } from "../connection";

type RawRepoWorkSessionRow = {
	id: string;
	project_repo_id: string;
	project_key: string;
	project_name: string;
	repo_root: string;
	branch: string | null;
	head_sha: string | null;
	start_at: number;
	end_at: number;
	is_open: number;
	max_insertions: number;
	max_deletions: number;
	files_json: string;
	updated_at: number;
	summary: string | null;
};

function parseFilesJson(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
			return parsed;
		}
		return [];
	} catch {
		return [];
	}
}

function toRepoWorkSession(row: RawRepoWorkSessionRow): RepoWorkSession {
	return {
		id: row.id,
		projectRepoId: row.project_repo_id,
		projectKey: row.project_key,
		projectName: row.project_name,
		repoRoot: row.repo_root,
		branch: row.branch,
		headSha: row.head_sha,
		startAt: row.start_at,
		endAt: row.end_at,
		isOpen: row.is_open === 1,
		maxInsertions: row.max_insertions,
		maxDeletions: row.max_deletions,
		files: parseFilesJson(row.files_json),
		updatedAt: row.updated_at,
		summary: row.summary,
	};
}

export type InsertRepoWorkSession = Omit<RepoWorkSession, "isOpen"> & {
	isOpen?: boolean;
};

export function insertRepoWorkSession(session: InsertRepoWorkSession): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
      INSERT INTO repo_work_sessions (
        id,
        project_repo_id,
        project_key,
        project_name,
        repo_root,
        branch,
        head_sha,
        start_at,
        end_at,
        is_open,
        max_insertions,
        max_deletions,
        files_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
	).run(
		session.id,
		session.projectRepoId,
		session.projectKey,
		session.projectName,
		session.repoRoot,
		session.branch ?? null,
		session.headSha ?? null,
		session.startAt,
		session.endAt,
		session.isOpen === false ? 0 : 1,
		session.maxInsertions,
		session.maxDeletions,
		JSON.stringify(session.files),
		session.updatedAt,
	);
}

export function getOpenWorkSessionByProjectRepoId(
	projectRepoId: string,
): RepoWorkSession | null {
	const db = getDatabaseOrNull();
	if (!db) return null;
	const row = db
		.prepare(
			"SELECT * FROM repo_work_sessions WHERE project_repo_id = ? AND is_open = 1 ORDER BY start_at DESC LIMIT 1",
		)
		.get(projectRepoId) as RawRepoWorkSessionRow | undefined;
	return row ? toRepoWorkSession(row) : null;
}

export function listWorkSessionsByProjectKeyInRange(options: {
	projectKey: string;
	startAt: number;
	endAt: number;
}): RepoWorkSession[] {
	const db = getDatabaseOrNull();
	if (!db) return [];
	const rows = db
		.prepare(
			`
        SELECT *
        FROM repo_work_sessions
        WHERE project_key = ?
          AND end_at >= ?
          AND start_at <= ?
        ORDER BY start_at DESC
      `,
		)
		.all(
			options.projectKey,
			options.startAt,
			options.endAt,
		) as RawRepoWorkSessionRow[];
	return rows.map(toRepoWorkSession);
}

export function updateWorkSessionById(
	id: string,
	updates: Partial<
		Pick<
			RepoWorkSession,
			| "endAt"
			| "branch"
			| "headSha"
			| "maxInsertions"
			| "maxDeletions"
			| "files"
			| "updatedAt"
			| "summary"
		>
	> & { isOpen?: boolean },
): void {
	const db = getDatabaseOrNull();
	if (!db) return;

	const parts: string[] = [];
	const params: unknown[] = [];

	if (updates.endAt !== undefined) {
		parts.push("end_at = ?");
		params.push(updates.endAt);
	}
	if (updates.branch !== undefined) {
		parts.push("branch = ?");
		params.push(updates.branch);
	}
	if (updates.headSha !== undefined) {
		parts.push("head_sha = ?");
		params.push(updates.headSha);
	}
	if (updates.maxInsertions !== undefined) {
		parts.push("max_insertions = ?");
		params.push(updates.maxInsertions);
	}
	if (updates.maxDeletions !== undefined) {
		parts.push("max_deletions = ?");
		params.push(updates.maxDeletions);
	}
	if (updates.files !== undefined) {
		parts.push("files_json = ?");
		params.push(JSON.stringify(updates.files));
	}
	if (updates.updatedAt !== undefined) {
		parts.push("updated_at = ?");
		params.push(updates.updatedAt);
	}
	if (updates.isOpen !== undefined) {
		parts.push("is_open = ?");
		params.push(updates.isOpen ? 1 : 0);
	}
	if (updates.summary !== undefined) {
		parts.push("summary = ?");
		params.push(updates.summary);
	}

	if (parts.length === 0) return;

	db.prepare(
		`UPDATE repo_work_sessions SET ${parts.join(", ")} WHERE id = ?`,
	).run(...params, id);
}

export function getWorkSessionById(id: string): RepoWorkSession | null {
	const db = getDatabaseOrNull();
	if (!db) return null;
	const row = db
		.prepare("SELECT * FROM repo_work_sessions WHERE id = ?")
		.get(id) as RawRepoWorkSessionRow | undefined;
	return row ? toRepoWorkSession(row) : null;
}

export function closeAllOpenWorkSessions(now: number): number {
	const db = getDatabaseOrNull();
	if (!db) return 0;
	const result = db
		.prepare(
			"UPDATE repo_work_sessions SET is_open = 0, end_at = ?, updated_at = ? WHERE is_open = 1",
		)
		.run(now, now);
	return result.changes;
}

export function deleteWorkSessionsBefore(
	cutoff: number,
	limit: number,
): string[] {
	const db = getDatabaseOrNull();
	if (!db) return [];
	const rows = db
		.prepare(
			`
        SELECT id
        FROM repo_work_sessions
        WHERE end_at < ?
        ORDER BY end_at ASC
        LIMIT ?
      `,
		)
		.all(cutoff, limit) as Array<{ id: string }>;
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const placeholders = ids.map(() => "?").join(",");
	db.prepare(
		`DELETE FROM repo_work_sessions WHERE id IN (${placeholders})`,
	).run(...ids);
	return ids;
}

export function deleteWorkSessionsByProjectRepoId(
	projectRepoId: string,
): number {
	const db = getDatabaseOrNull();
	if (!db) return 0;
	const result = db
		.prepare("DELETE FROM repo_work_sessions WHERE project_repo_id = ?")
		.run(projectRepoId);
	return result.changes;
}
