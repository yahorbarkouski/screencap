import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteSentInvite,
	deleteSentInvitesForRoom,
	getSentInvite,
	hasPendingInvite,
	listSentInvitesForRoom,
	markInviteAccepted,
	updateSentInviteStatus,
	upsertSentInvite,
	type SentInvite,
} from "../RoomInvitesSentRepository";

vi.mock("../../connection", () => {
	let mockData: Record<string, SentInvite> = {};

	const mockDb = {
		prepare: (sql: string) => ({
			all: (roomId: string) => {
				return Object.values(mockData)
					.filter((i) => i.roomId === roomId)
					.sort((a, b) => b.sentAt - a.sentAt)
					.map((i) => ({
						id: i.id,
						room_id: i.roomId,
						to_user_id: i.toUserId,
						to_username: i.toUsername,
						sent_at: i.sentAt,
						status: i.status,
					}));
			},
			get: (...args: string[]) => {
				if (sql.includes("status = 'pending'")) {
					const [roomId, toUserId] = args;
					const invite = Object.values(mockData).find(
						(i) =>
							i.roomId === roomId &&
							i.toUserId === toUserId &&
							i.status === "pending",
					);
					return invite ? { 1: 1 } : undefined;
				}
				if (args.length === 2) {
					const [roomId, toUserId] = args;
					const invite = Object.values(mockData).find(
						(i) => i.roomId === roomId && i.toUserId === toUserId,
					);
					if (!invite) return undefined;
					return {
						id: invite.id,
						room_id: invite.roomId,
						to_user_id: invite.toUserId,
						to_username: invite.toUsername,
						sent_at: invite.sentAt,
						status: invite.status,
					};
				}
				return undefined;
			},
			run: (...args: unknown[]) => {
				if (sql.includes("INSERT INTO")) {
					const [id, roomId, toUserId, toUsername, sentAt, status] =
						args as string[];
					const key = `${roomId}:${toUserId}`;
					mockData[key] = {
						id,
						roomId,
						toUserId,
						toUsername,
						sentAt: Number(sentAt),
						status: status as SentInvite["status"],
					};
				} else if (sql.includes("UPDATE")) {
					const [status, roomId, toUserId] = args as string[];
					const key = `${roomId}:${toUserId}`;
					if (mockData[key]) {
						mockData[key].status = status as SentInvite["status"];
					}
				} else if (sql.includes("DELETE")) {
					if (args.length === 1) {
						const [roomId] = args as string[];
						for (const key of Object.keys(mockData)) {
							if (key.startsWith(`${roomId}:`)) {
								delete mockData[key];
							}
						}
					} else {
						const [roomId, toUserId] = args as string[];
						delete mockData[`${roomId}:${toUserId}`];
					}
				}
			},
		}),
	};

	return {
		isDbOpen: () => true,
		getDatabase: () => mockDb,
		__resetMockData: () => {
			mockData = {};
		},
		__getMockData: () => mockData,
	};
});

describe("RoomInvitesSentRepository", () => {
	beforeEach(async () => {
		const { __resetMockData } = await import("../../connection");
		(__resetMockData as () => void)();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("upsertSentInvite", () => {
		it("inserts a new invite", () => {
			const invite: SentInvite = {
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			};

			upsertSentInvite(invite);

			const result = getSentInvite("room-1", "user-1");
			expect(result).toEqual(invite);
		});

		it("updates existing invite on conflict", () => {
			const invite1: SentInvite = {
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			};

			const invite2: SentInvite = {
				id: "invite-2",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john_updated",
				sentAt: 2000,
				status: "accepted",
			};

			upsertSentInvite(invite1);
			upsertSentInvite(invite2);

			const result = getSentInvite("room-1", "user-1");
			expect(result?.id).toBe("invite-2");
			expect(result?.toUsername).toBe("john_updated");
			expect(result?.status).toBe("accepted");
		});
	});

	describe("listSentInvitesForRoom", () => {
		it("returns invites sorted by sentAt descending", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			upsertSentInvite({
				id: "invite-2",
				roomId: "room-1",
				toUserId: "user-2",
				toUsername: "jane",
				sentAt: 2000,
				status: "pending",
			});

			const result = listSentInvitesForRoom("room-1");
			expect(result).toHaveLength(2);
			expect(result[0].toUserId).toBe("user-2");
			expect(result[1].toUserId).toBe("user-1");
		});

		it("returns empty array for room with no invites", () => {
			const result = listSentInvitesForRoom("nonexistent-room");
			expect(result).toEqual([]);
		});
	});

	describe("hasPendingInvite", () => {
		it("returns true for pending invite", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			expect(hasPendingInvite("room-1", "user-1")).toBe(true);
		});

		it("returns false for accepted invite", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "accepted",
			});

			expect(hasPendingInvite("room-1", "user-1")).toBe(false);
		});

		it("returns false for no invite", () => {
			expect(hasPendingInvite("room-1", "user-1")).toBe(false);
		});
	});

	describe("updateSentInviteStatus", () => {
		it("updates invite status", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			updateSentInviteStatus("room-1", "user-1", "accepted");

			const result = getSentInvite("room-1", "user-1");
			expect(result?.status).toBe("accepted");
		});
	});

	describe("markInviteAccepted", () => {
		it("marks invite as accepted", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			markInviteAccepted("room-1", "user-1");

			const result = getSentInvite("room-1", "user-1");
			expect(result?.status).toBe("accepted");
		});
	});

	describe("deleteSentInvitesForRoom", () => {
		it("deletes all invites for a room", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			upsertSentInvite({
				id: "invite-2",
				roomId: "room-1",
				toUserId: "user-2",
				toUsername: "jane",
				sentAt: 2000,
				status: "pending",
			});

			deleteSentInvitesForRoom("room-1");

			expect(listSentInvitesForRoom("room-1")).toEqual([]);
		});
	});

	describe("deleteSentInvite", () => {
		it("deletes specific invite", () => {
			upsertSentInvite({
				id: "invite-1",
				roomId: "room-1",
				toUserId: "user-1",
				toUsername: "john",
				sentAt: 1000,
				status: "pending",
			});

			upsertSentInvite({
				id: "invite-2",
				roomId: "room-1",
				toUserId: "user-2",
				toUsername: "jane",
				sentAt: 2000,
				status: "pending",
			});

			deleteSentInvite("room-1", "user-1");

			const remaining = listSentInvitesForRoom("room-1");
			expect(remaining).toHaveLength(1);
			expect(remaining[0].toUserId).toBe("user-2");
		});
	});
});
