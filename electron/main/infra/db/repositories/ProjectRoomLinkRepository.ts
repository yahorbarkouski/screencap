import { getDatabase, isDbOpen } from "../connection";

export type ProjectRoomLink = {
	projectName: string;
	roomId: string;
	createdAt: number;
};

export function getRoomIdForProject(projectName: string): string | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare("SELECT room_id FROM project_room_links WHERE project_name = ?")
		.get(projectName) as { room_id?: string } | undefined;
	return row?.room_id ?? null;
}

export function upsertProjectRoomLink(params: {
	projectName: string;
	roomId: string;
	createdAt: number;
}): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare(
		`
    INSERT INTO project_room_links (project_name, room_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (project_name) DO UPDATE SET
      room_id = excluded.room_id
  `,
	).run(params.projectName, params.roomId, params.createdAt);
}

export function deleteProjectRoomLink(projectName: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM project_room_links WHERE project_name = ?").run(
		projectName,
	);
}

export function deleteProjectRoomLinkByRoomId(roomId: string): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM project_room_links WHERE room_id = ?").run(roomId);
}
