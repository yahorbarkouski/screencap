import type { ProjectShare } from "../../../../shared/types";
import { getDatabase, isDbOpen } from "../connection";
import { transformRow, transformRows } from "../transformers";

type RawRow = Record<string, unknown>;

type ProjectShareDbRow = {
	projectName: string;
	publicId: string;
	writeKey: string;
	shareUrl: string;
	createdAt: number;
	updatedAt: number;
	lastPublishedAt: number | null;
};

export function getProjectShare(projectName: string): ProjectShare | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare("SELECT * FROM project_shares WHERE project_name = ?")
		.get(projectName) as RawRow | undefined;
	if (!row) return null;
	return transformRow<ProjectShareDbRow>(row) as ProjectShare;
}

export function getProjectShareByPublicId(
	publicId: string,
): ProjectShare | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare("SELECT * FROM project_shares WHERE public_id = ?")
		.get(publicId) as RawRow | undefined;
	if (!row) return null;
	return transformRow<ProjectShareDbRow>(row) as ProjectShare;
}

export function getAllProjectShares(): ProjectShare[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare("SELECT * FROM project_shares ORDER BY created_at DESC")
		.all() as RawRow[];
	return transformRows<ProjectShareDbRow>(rows) as ProjectShare[];
}

export function insertProjectShare(share: ProjectShare): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
    INSERT INTO project_shares (
      project_name, public_id, write_key, share_url,
      created_at, updated_at, last_published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
	).run(
		share.projectName,
		share.publicId,
		share.writeKey,
		share.shareUrl,
		share.createdAt,
		share.updatedAt,
		share.lastPublishedAt,
	);
}

export function updateProjectShareLastPublished(
	projectName: string,
	lastPublishedAt: number,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
    UPDATE project_shares
    SET last_published_at = ?, updated_at = ?
    WHERE project_name = ?
  `,
	).run(lastPublishedAt, Date.now(), projectName);
}

export function deleteProjectShare(projectName: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM project_shares WHERE project_name = ?").run(
		projectName,
	);
}
