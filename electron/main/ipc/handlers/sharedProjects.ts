import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type { SharedEvent, SharedProject } from "../../../shared/types";
import {
	getSharedProjectEvents,
	listSharedProjects,
	syncAllRooms,
	syncRoom,
} from "../../features/sharedProjects";
import { secureHandle } from "../secure";

const noArgs = z.tuple([]);
const roomIdArg = z.tuple([z.string().trim().min(1).max(256)]);
const getEventsArgs = z.tuple([
	z.object({
		roomId: z.string().trim().min(1).max(256),
		startDate: z.number().int().optional(),
		endDate: z.number().int().optional(),
		limit: z.number().int().optional(),
	}),
]);

export function registerSharedProjectsHandlers(): void {
	secureHandle(
		IpcChannels.SharedProjects.List,
		noArgs,
		(): SharedProject[] => {
			return listSharedProjects();
		},
	);

	secureHandle(
		IpcChannels.SharedProjects.GetEvents,
		getEventsArgs,
		(params: {
			roomId: string;
			startDate?: number;
			endDate?: number;
			limit?: number;
		}): SharedEvent[] => {
			return getSharedProjectEvents(params);
		},
	);

	secureHandle(
		IpcChannels.SharedProjects.Sync,
		roomIdArg,
		async (roomId: string): Promise<{ count: number }> => {
			return await syncRoom(roomId);
		},
	);

	secureHandle(
		IpcChannels.SharedProjects.SyncAll,
		noArgs,
		async (): Promise<void> => {
			await syncAllRooms();
		},
	);
}
