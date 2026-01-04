import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteStatus } from "../RoomsService";

vi.mock("electron", () => ({
	safeStorage: {
		isEncryptionAvailable: () => false,
	},
}));

vi.mock("../../../infra/db/repositories/RoomMembersCacheRepository", () => ({
	listRoomMembers: vi.fn(),
}));

vi.mock("../../../infra/db/repositories/RoomInvitesSentRepository", () => ({
	hasPendingInvite: vi.fn(),
	listSentInvitesForRoom: vi.fn(),
	upsertSentInvite: vi.fn(),
	getSentInvite: vi.fn(),
}));

describe("RoomsService", () => {
	describe("getInviteStatusForFriend", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns 'member' if user is already a room member", async () => {
			const { listRoomMembers } = await import(
				"../../../infra/db/repositories/RoomMembersCacheRepository"
			);
			const { hasPendingInvite } = await import(
				"../../../infra/db/repositories/RoomInvitesSentRepository"
			);

			vi.mocked(listRoomMembers).mockReturnValue([
				{ roomId: "room-1", userId: "user-1", username: "john", role: "member" },
			]);
			vi.mocked(hasPendingInvite).mockReturnValue(false);

			const { getInviteStatusForFriend } = await import("../RoomsService");
			const result: InviteStatus = getInviteStatusForFriend("room-1", "user-1");

			expect(result).toBe("member");
		});

		it("returns 'pending' if user has pending invite", async () => {
			const { listRoomMembers } = await import(
				"../../../infra/db/repositories/RoomMembersCacheRepository"
			);
			const { hasPendingInvite } = await import(
				"../../../infra/db/repositories/RoomInvitesSentRepository"
			);

			vi.mocked(listRoomMembers).mockReturnValue([]);
			vi.mocked(hasPendingInvite).mockReturnValue(true);

			const { getInviteStatusForFriend } = await import("../RoomsService");
			const result: InviteStatus = getInviteStatusForFriend("room-1", "user-1");

			expect(result).toBe("pending");
		});

		it("returns 'none' if user is neither member nor has pending invite", async () => {
			const { listRoomMembers } = await import(
				"../../../infra/db/repositories/RoomMembersCacheRepository"
			);
			const { hasPendingInvite } = await import(
				"../../../infra/db/repositories/RoomInvitesSentRepository"
			);

			vi.mocked(listRoomMembers).mockReturnValue([]);
			vi.mocked(hasPendingInvite).mockReturnValue(false);

			const { getInviteStatusForFriend } = await import("../RoomsService");
			const result: InviteStatus = getInviteStatusForFriend("room-1", "user-1");

			expect(result).toBe("none");
		});

		it("checks member status before pending invite", async () => {
			const { listRoomMembers } = await import(
				"../../../infra/db/repositories/RoomMembersCacheRepository"
			);
			const { hasPendingInvite } = await import(
				"../../../infra/db/repositories/RoomInvitesSentRepository"
			);

			vi.mocked(listRoomMembers).mockReturnValue([
				{ roomId: "room-1", userId: "user-1", username: "john", role: "member" },
			]);
			vi.mocked(hasPendingInvite).mockReturnValue(true);

			const { getInviteStatusForFriend } = await import("../RoomsService");
			const result: InviteStatus = getInviteStatusForFriend("room-1", "user-1");

			expect(result).toBe("member");
			expect(hasPendingInvite).not.toHaveBeenCalled();
		});
	});

	describe("listSentInvites", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns sent invites from repository", async () => {
			const { listSentInvitesForRoom } = await import(
				"../../../infra/db/repositories/RoomInvitesSentRepository"
			);

			const mockInvites = [
				{
					id: "invite-1",
					roomId: "room-1",
					toUserId: "user-1",
					toUsername: "john",
					sentAt: 1000,
					status: "pending" as const,
				},
			];
			vi.mocked(listSentInvitesForRoom).mockReturnValue(mockInvites);

			const { listSentInvites } = await import("../RoomsService");
			const result = listSentInvites("room-1");

			expect(result).toEqual(mockInvites);
			expect(listSentInvitesForRoom).toHaveBeenCalledWith("room-1");
		});
	});
});
