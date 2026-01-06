import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type {
	AvatarSettings,
	Friend,
	FriendRequest,
	SocialIdentity,
} from "../../../shared/types";
import {
	acceptFriendRequest,
	listFriendRequests,
	listFriends,
	rejectFriendRequest,
	sendFriendRequest,
} from "../../features/social/FriendsService";
import {
	getIdentity,
	registerUsername,
	syncAvatarSettings,
} from "../../features/social/IdentityService";
import { generateSocialShareImage } from "../../features/social/SocialShareImageService";
import { secureHandle } from "../secure";

const noArgs = z.tuple([]);
const usernameArg = z.tuple([z.string().trim().min(3).max(32)]);
const idArg = z.tuple([z.string().trim().min(1).max(256)]);
const avatarSettingsArg = z.tuple([
	z.object({
		pattern: z.literal("ascii"),
		backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		foregroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		asciiChar: z
			.string()
			.trim()
			.min(1)
			.max(1)
			.regex(/^[\x21-\x7E]$/)
			.default("@"),
	}),
]);
const generateSocialImageArg = z.tuple([
	z.object({
		imagePaths: z.array(z.string().trim().min(1).max(2048)).min(1).max(12),
		title: z.string().trim().min(1).max(240),
		timestamp: z.number().finite(),
		category: z.string().trim().min(1).max(64).nullable(),
		appName: z.string().trim().min(1).max(128).nullable(),
		appIconPath: z.string().trim().min(1).max(2048).nullable(),
		backgroundTitle: z.string().trim().min(1).max(160).nullable(),
		backgroundArtist: z.string().trim().min(1).max(160).nullable(),
		backgroundImageUrl: z.string().trim().min(1).max(2048).nullable(),
	}),
]);

export function registerSocialHandlers(): void {
	secureHandle(
		IpcChannels.Social.GetIdentity,
		noArgs,
		(): SocialIdentity | null => {
			const identity = getIdentity();
			if (!identity) return null;
			return {
				userId: identity.userId,
				deviceId: identity.deviceId,
				username: identity.username,
			};
		},
	);

	secureHandle(
		IpcChannels.Social.RegisterUsername,
		usernameArg,
		async (username: string): Promise<SocialIdentity> => {
			const identity = await registerUsername(username);
			return {
				userId: identity.userId,
				deviceId: identity.deviceId,
				username: identity.username,
			};
		},
	);

	secureHandle(
		IpcChannels.Social.SendFriendRequest,
		usernameArg,
		async (
			toUsername: string,
		): Promise<{ requestId: string; status: "pending" | "accepted" }> => {
			return await sendFriendRequest(toUsername);
		},
	);

	secureHandle(
		IpcChannels.Social.ListFriends,
		noArgs,
		async (): Promise<Friend[]> => {
			return await listFriends();
		},
	);

	secureHandle(
		IpcChannels.Social.ListFriendRequests,
		noArgs,
		async (): Promise<FriendRequest[]> => {
			return await listFriendRequests();
		},
	);

	secureHandle(
		IpcChannels.Social.AcceptFriendRequest,
		idArg,
		async (requestId: string): Promise<void> => {
			await acceptFriendRequest(requestId);
		},
	);

	secureHandle(
		IpcChannels.Social.RejectFriendRequest,
		idArg,
		async (requestId: string): Promise<void> => {
			await rejectFriendRequest(requestId);
		},
	);

	secureHandle(
		IpcChannels.Social.SyncAvatarSettings,
		avatarSettingsArg,
		async (avatarSettings: AvatarSettings): Promise<void> => {
			await syncAvatarSettings(avatarSettings);
		},
	);

	secureHandle(
		IpcChannels.Social.GenerateSocialImage,
		generateSocialImageArg,
		async (input) => {
			return await generateSocialShareImage(input);
		},
	);
}
