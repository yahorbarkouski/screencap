import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, Notification } from "electron";
import { getChatLastReadTimestampMs } from "../../infra/db/repositories/ChatUnreadStateRepository";
import { getEventById } from "../../infra/db/repositories/EventRepository";
import { listRoomMembershipsByRole } from "../../infra/db/repositories/RoomMembershipsRepository";
import { createLogger } from "../../infra/log";
import { fetchMessages, openProjectThread } from "../chat/ChatService";
import { handleForbiddenRoomError } from "../rooms/RoomAccess";
import { listFriends } from "../social/FriendsService";
import { getIdentity } from "../social/IdentityService";
import { addUnreadForThread, clearUnreadForThread } from "./UnreadCommentState";

const logger = createLogger({ scope: "SocialCommentNotifications" });

const POLL_INTERVAL_MS = 10_000;
const FETCH_LIMIT = 100;
const MAX_NOTIFICATIONS_PER_POLL = 3;
const SOUND_MIN_INTERVAL_MS = 1200;

type ThreadCursor = {
	lastSeenTimestampMs: number;
	seenIdsAtLastTimestamp: Set<string>;
};

let interval: NodeJS.Timeout | null = null;
let inFlight = false;
let startedAtMs: number | null = null;
const cursors = new Map<string, ThreadCursor>();
const joinedProjectRoomIds = new Set<string>();
let lastSoundAtMs = 0;

let cachedFriendMap: Map<string, string> | null = null;
let friendsCacheExpiresAtMs = 0;

async function getFriendUsernameById(): Promise<Map<string, string>> {
	const now = Date.now();
	if (cachedFriendMap && now < friendsCacheExpiresAtMs) return cachedFriendMap;
	try {
		const friends = await listFriends();
		const map = new Map<string, string>();
		for (const f of friends) map.set(f.userId, f.username);
		cachedFriendMap = map;
		friendsCacheExpiresAtMs = now + 60_000;
		return map;
	} catch {
		// If we can't refresh, fall back to existing cache.
		return cachedFriendMap ?? new Map();
	}
}

function getStartedAtMs(): number {
	if (startedAtMs === null) startedAtMs = Date.now();
	return startedAtMs;
}

function parseEventComment(
	messageText: string,
): { eventId: string; comment: string } | null {
	const PREFIX = "@event:" as const;
	if (!messageText.startsWith(PREFIX)) return null;
	const rest = messageText.slice(PREFIX.length);
	const spaceIdx = rest.indexOf(" ");
	if (spaceIdx <= 0) return null;
	const eventId = rest.slice(0, spaceIdx).trim();
	const comment = rest.slice(spaceIdx + 1).trim();
	if (!eventId) return null;
	return { eventId, comment };
}

function safeIsNotificationsSupported(): boolean {
	const fn = (Notification as unknown as { isSupported?: () => boolean })
		.isSupported;
	if (typeof fn === "function") {
		try {
			return fn();
		} catch {
			return false;
		}
	}
	return true;
}

function truncate(text: string, max = 120): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function resolveNotificationSoundPath(): string | null {
	// Packaged default (CI/CD): electron-builder extraResources -> sounds/notification.wav
	try {
		const p = join(process.resourcesPath, "sounds", "notification.wav");
		if (existsSync(p)) return p;
	} catch {}

	// Production override: user can place a file here.
	try {
		const p = join(app.getPath("userData"), "sounds", "notification.wav");
		if (existsSync(p)) return p;
	} catch {}

	// Dev convenience: use the workspace file if present.
	if (process.env.NODE_ENV === "development") {
		try {
			const p = join(process.cwd(), ".cursor", "sound", "notification.wav");
			if (existsSync(p)) return p;
		} catch {}
	}

	return null;
}

function playNotificationSound(): void {
	if (process.platform !== "darwin") return;
	const now = Date.now();
	if (now - lastSoundAtMs < SOUND_MIN_INTERVAL_MS) return;
	lastSoundAtMs = now;

	const soundPath = resolveNotificationSoundPath();
	if (!soundPath) return;

	try {
		// macOS: play custom wav without blocking the app.
		const child = spawn("afplay", [soundPath], {
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	} catch (error) {
		logger.debug("Failed to play notification sound", { error: String(error) });
	}
}

function showNotification(params: { title: string; body: string }): void {
	if (!safeIsNotificationsSupported()) return;
	try {
		playNotificationSound();
		const n = new Notification({
			title: params.title,
			body: params.body,
			silent: process.platform === "darwin",
		});
		n.show();
	} catch (error) {
		logger.warn("Failed to show notification", { error: String(error) });
	}
}

async function ensureBaselineCursor(threadId: string): Promise<void> {
	if (cursors.has(threadId)) return;
	// Baseline to service start time, not "first time we happened to notice the
	// thread". Otherwise a comment that arrives right after you publish (but before
	// the next poll) can get silently skipped.
	cursors.set(threadId, {
		lastSeenTimestampMs: getStartedAtMs(),
		seenIdsAtLastTimestamp: new Set(),
	});
}

function clearRoomPollingState(roomId: string): void {
	const threadId = `project_${roomId}`;
	cursors.delete(threadId);
	joinedProjectRoomIds.delete(roomId);
	clearUnreadForThread(threadId);
}

async function pollOnce(): Promise<void> {
	const identity = getIdentity();
	if (!identity) return;

	if (inFlight) return;
	inFlight = true;

	try {
		const usernameById = await getFriendUsernameById();

		// Notifications are for "my published events" — those live in rooms I own.
		// Avoid auto-joining chat threads for rooms owned by other people.
		const ownedRooms = listRoomMembershipsByRole("owner");
		const roomIds = ownedRooms.map((m) => m.roomId);

		let notificationsShown = 0;

		for (const roomId of roomIds) {
			try {
				// IMPORTANT: the backend only adds you to a project chat thread when you
				// explicitly open it. Without this, you can't list messages and you'll miss
				// background notifications.
				if (!joinedProjectRoomIds.has(roomId)) {
					await openProjectThread(roomId);
					joinedProjectRoomIds.add(roomId);
				}

				const threadId = `project_${roomId}`;

				await ensureBaselineCursor(threadId);
				const cursor = cursors.get(threadId);
				if (!cursor) continue;

				const since = Math.max(0, cursor.lastSeenTimestampMs - 1);
				let messages = await fetchMessages({
					threadId,
					since,
					limit: FETCH_LIMIT,
				});

				// Ensure deterministic processing order.
				messages = messages.sort((a, b) => a.timestampMs - b.timestampMs);

				for (const m of messages) {
					// Handle duplicates from inclusive `since` behavior while still catching
					// same-millisecond messages.
					if (m.timestampMs < cursor.lastSeenTimestampMs) continue;
					if (m.timestampMs === cursor.lastSeenTimestampMs) {
						if (cursor.seenIdsAtLastTimestamp.has(m.id)) continue;
						cursor.seenIdsAtLastTimestamp.add(m.id);
					} else {
						cursor.lastSeenTimestampMs = m.timestampMs;
						cursor.seenIdsAtLastTimestamp = new Set([m.id]);
					}

					const parsed = parseEventComment(m.text);
					if (!parsed) continue;
					if (m.authorUserId === identity.userId) continue;

					// Don't notify for comments you've already read.
					const lastRead = getChatLastReadTimestampMs(threadId);
					if (m.timestampMs <= lastRead) continue;

					const localEvent = getEventById(parsed.eventId);
					if (!localEvent) continue;

					addUnreadForThread(threadId, 1);

					if (notificationsShown < MAX_NOTIFICATIONS_PER_POLL) {
						const authorUsername =
							usernameById.get(m.authorUserId) ?? "Someone";
						showNotification({
							title: `${authorUsername} commented`,
							body: truncate(parsed.comment || "New comment", 160),
						});
						notificationsShown += 1;
					}
				}
			} catch (error) {
				if (
					handleForbiddenRoomError({
						roomId,
						error,
						source: "social_comment_poll",
					})
				) {
					clearRoomPollingState(roomId);
					continue;
				}
				logger.debug("Poll room failed", { roomId, error: String(error) });
			}
		}
	} catch (error) {
		logger.debug("Poll failed", { error: String(error) });
	} finally {
		inFlight = false;
	}
}

export function startSocialCommentNotifications(): void {
	if (interval) return;
	getStartedAtMs();

	// Run immediately so we don't have a dead window right after app start / publish.
	void pollOnce();

	interval = setInterval(() => {
		void pollOnce();
	}, POLL_INTERVAL_MS);

	logger.info("Social comment notifications started", {
		intervalMs: POLL_INTERVAL_MS,
	});
}

export function stopSocialCommentNotifications(): void {
	if (!interval) return;
	clearInterval(interval);
	interval = null;
	inFlight = false;
	startedAtMs = null;
	cursors.clear();
	joinedProjectRoomIds.clear();
	cachedFriendMap = null;
	friendsCacheExpiresAtMs = 0;
	lastSoundAtMs = 0;
	logger.info("Social comment notifications stopped");
}
