import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type {
	Room,
	RoomInvite,
	RoomTimelineEvent,
} from "../../../shared/types";
import {
	acceptRoomInvite,
	ensureRoomForProject,
	inviteFriendToProjectRoom,
	listIncomingRoomInvites,
	listRooms,
} from "../../features/rooms/RoomsService";
import { fetchRoomEvents } from "../../features/sync/RoomSyncService";
import { secureHandle } from "../secure";

const noArgs = z.tuple([]);
const projectNameArg = z.tuple([z.string().trim().min(1).max(200)]);
const inviteArgs = z.tuple([
	z.string().trim().min(1).max(200),
	z.string().trim().min(1).max(256),
]);
const acceptInviteArgs = z.tuple([
	z.object({
		roomId: z.string().trim().min(1).max(256),
		roomName: z.string().trim().min(1).max(200),
		ownerUserId: z.string().trim().min(1).max(256),
		ownerUsername: z.string().trim().min(1).max(200),
	}),
]);
const roomEventsArgs = z.union([
	z.tuple([z.string().trim().min(1).max(256)]),
	z.tuple([z.string().trim().min(1).max(256), z.number().int().optional()]),
]);

export function registerRoomsHandlers(): void {
	secureHandle(
		IpcChannels.Rooms.EnsureProjectRoom,
		projectNameArg,
		async (projectName: string): Promise<string> => {
			return await ensureRoomForProject({ projectName });
		},
	);

	secureHandle(
		IpcChannels.Rooms.InviteFriendToProjectRoom,
		inviteArgs,
		async (projectName: string, friendUserId: string): Promise<void> => {
			await inviteFriendToProjectRoom({ projectName, friendUserId });
		},
	);

	secureHandle(
		IpcChannels.Rooms.ListRooms,
		noArgs,
		async (): Promise<Room[]> => {
			return await listRooms();
		},
	);

	secureHandle(
		IpcChannels.Rooms.ListInvites,
		noArgs,
		async (): Promise<RoomInvite[]> => {
			return await listIncomingRoomInvites();
		},
	);

	secureHandle(
		IpcChannels.Rooms.AcceptProjectInvite,
		acceptInviteArgs,
		async (params: {
			roomId: string;
			roomName: string;
			ownerUserId: string;
			ownerUsername: string;
		}): Promise<void> => {
			await acceptRoomInvite(params);
		},
	);

	secureHandle(
		IpcChannels.Rooms.FetchRoomEvents,
		roomEventsArgs,
		async (roomId: string, since?: number): Promise<RoomTimelineEvent[]> => {
			const events = await fetchRoomEvents({ roomId, since });
			return events.map((e) => ({
				id: e.id,
				roomId: e.roomId,
				authorUserId: e.authorUserId,
				timestampMs: e.timestampMs,
				caption: e.caption,
				imageRef: e.imageRef,
			}));
		},
	);
}
