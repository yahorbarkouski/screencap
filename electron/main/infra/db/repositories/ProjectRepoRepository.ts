import type { ProjectRepo } from "../../../../shared/types";
import { getDatabase, getDatabaseOrNull, isDbOpen } from "../connection";

type RawProjectRepoRow = {
	id: string;
	project_key: string;
	project_name: string;
	repo_root: string;
	created_at: number;
};

function toProjectRepo(row: RawProjectRepoRow): ProjectRepo {
	return {
		id: row.id,
		projectKey: row.project_key,
		projectName: row.project_name,
		repoRoot: row.repo_root,
		createdAt: row.created_at,
	};
}

export function insertProjectRepo(repo: ProjectRepo): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
      INSERT INTO project_repos (id, project_key, project_name, repo_root, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
	).run(
		repo.id,
		repo.projectKey,
		repo.projectName,
		repo.repoRoot,
		repo.createdAt,
	);
}

export function getProjectRepoById(id: string): ProjectRepo | null {
	const db = getDatabaseOrNull();
	if (!db) return null;
	const row = db.prepare("SELECT * FROM project_repos WHERE id = ?").get(id) as
		| RawProjectRepoRow
		| undefined;
	return row ? toProjectRepo(row) : null;
}

export function findProjectRepoByKeyAndRoot(
	projectKey: string,
	repoRoot: string,
): ProjectRepo | null {
	const db = getDatabaseOrNull();
	if (!db) return null;
	const row = db
		.prepare(
			"SELECT * FROM project_repos WHERE project_key = ? AND repo_root = ?",
		)
		.get(projectKey, repoRoot) as RawProjectRepoRow | undefined;
	return row ? toProjectRepo(row) : null;
}

export function listProjectReposByProjectKey(
	projectKey: string,
): ProjectRepo[] {
	const db = getDatabaseOrNull();
	if (!db) return [];
	const rows = db
		.prepare(
			"SELECT * FROM project_repos WHERE project_key = ? ORDER BY created_at DESC",
		)
		.all(projectKey) as RawProjectRepoRow[];
	return rows.map(toProjectRepo);
}

export function listAllProjectRepos(): ProjectRepo[] {
	const db = getDatabaseOrNull();
	if (!db) return [];
	const rows = db
		.prepare("SELECT * FROM project_repos ORDER BY created_at DESC")
		.all() as RawProjectRepoRow[];
	return rows.map(toProjectRepo);
}

export function deleteProjectRepoById(id: string): void {
	const db = getDatabaseOrNull();
	if (!db) return;
	db.prepare("DELETE FROM project_repos WHERE id = ?").run(id);
}
