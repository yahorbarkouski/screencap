import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type {
	Room,
	RoomInvite,
	RoomMember,
	RoomTimelineEvent,
	SentInvite,
} from "../../../shared/types";
import {
	acceptRoomInvite,
	ensureRoomForProject,
	fetchAndSyncRoomMembers,
	getInviteStatusForFriend,
	type InviteStatus,
	inviteFriendToProjectRoom,
	listIncomingRoomInvites,
	listRooms,
	listSentInvites,
} from "../../features/rooms/RoomsService";
import { fetchRoomEvents } from "../../features/sync/RoomSyncService";
import { secureHandle } from "../secure";

const noArgs = z.tuple([]);
const projectNameArg = z.tuple([z.string().trim().min(1).max(200)]);
const inviteArgs = z.tuple([
	z.object({
		projectName: z.string().trim().min(1).max(200),
		friendUserId: z.string().trim().min(1).max(256),
		friendUsername: z.string().trim().min(1).max(200).optional(),
	}),
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
const roomIdArg = z.tuple([z.string().trim().min(1).max(256)]);
const inviteStatusArgs = z.tuple([
	z.string().trim().min(1).max(256),
	z.string().trim().min(1).max(256),
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
		async (params: {
			projectName: string;
			friendUserId: string;
			friendUsername?: string;
		}): Promise<{
			status: "invited" | "already_member" | "already_invited";
		}> => {
			return await inviteFriendToProjectRoom(params);
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

	secureHandle(
		IpcChannels.Rooms.GetRoomMembers,
		roomIdArg,
		async (roomId: string): Promise<RoomMember[]> => {
			return await fetchAndSyncRoomMembers(roomId);
		},
	);

	secureHandle(
		IpcChannels.Rooms.ListSentInvites,
		roomIdArg,
		async (roomId: string): Promise<SentInvite[]> => {
			const invites = listSentInvites(roomId);
			return invites.map((i) => ({
				id: i.id,
				roomId: i.roomId,
				toUserId: i.toUserId,
				toUsername: i.toUsername,
				sentAt: i.sentAt,
				status: i.status,
			}));
		},
	);

	secureHandle(
		IpcChannels.Rooms.GetInviteStatus,
		inviteStatusArgs,
		async (roomId: string, friendUserId: string): Promise<InviteStatus> => {
			return getInviteStatusForFriend(roomId, friendUserId);
		},
	);
}
