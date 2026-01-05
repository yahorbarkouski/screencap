import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type { DayWrappedSnapshot, SharedEvent } from "../../../shared/types";
import {
	ensureFriendsFeedRoom,
	getLatestFriendDayWrappedSnapshot,
	getSocialFeedEvents,
	publishEventToAllFriends,
} from "../../features/socialFeed";
import { secureHandle } from "../secure";

const noArgs = z.tuple([]);
const friendUserIdArg = z.tuple([z.string().trim().min(1).max(256)]);
const getFeedArgs = z.union([
	z.tuple([]),
	z.tuple([
		z
			.object({
				startDate: z.number().int().nonnegative().optional(),
				endDate: z.number().int().nonnegative().optional(),
				limit: z.number().int().min(1).max(200).optional(),
				includeOwnEvents: z.boolean().optional(),
			})
			.strip(),
	]),
]);
const eventIdArg = z.tuple([z.string().trim().min(1).max(128)]);

export function registerSocialFeedHandlers(): void {
	secureHandle(
		IpcChannels.SocialFeed.EnsureFriendsFeedRoom,
		noArgs,
		async (): Promise<string> => {
			return await ensureFriendsFeedRoom();
		},
	);

	secureHandle(
		IpcChannels.SocialFeed.GetFeed,
		getFeedArgs,
		async (params?: {
			startDate?: number;
			endDate?: number;
			limit?: number;
			includeOwnEvents?: boolean;
		}): Promise<SharedEvent[]> => {
			return getSocialFeedEvents(params);
		},
	);

	secureHandle(
		IpcChannels.SocialFeed.GetFriendDayWrapped,
		friendUserIdArg,
		async (friendUserId: string): Promise<DayWrappedSnapshot | null> => {
			return getLatestFriendDayWrappedSnapshot(friendUserId);
		},
	);

	secureHandle(
		IpcChannels.SocialFeed.PublishEventToAllFriends,
		eventIdArg,
		async (eventId: string): Promise<void> => {
			await publishEventToAllFriends(eventId);
		},
	);
}
