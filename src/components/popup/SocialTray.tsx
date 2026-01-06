import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	AppWindow,
	ChevronLeft,
	Music,
	Plus,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";
import { generateAvatarDataUrl, getDefaultAvatarSettings } from "@/lib/avatar";
import {
	CATEGORY_RGB,
	type DaylineSlot,
	SLOTS_PER_DAY,
	toCategory,
} from "@/lib/dayline";
import { encodeEventComment } from "@/lib/socialComments";
import type {
	ChatMessage,
	DayWrappedSnapshot,
	Friend,
	FriendRequest,
	RoomInvite,
	SharedEvent,
	SocialIdentity,
} from "@/types";
import { AvatarDisplay } from "./AvatarDisplay";
import { type DaylineViewMode, VIEW_MODE_ORDER } from "./Dayline";
import { PersonView } from "./PersonView";
import { SharedEventDetail } from "./SharedEventDetail";

const READ_EVENTS_STORAGE_KEY = "screencap:readEventIds";
const MAX_STORED_READ_IDS = 500;

function getReadEventIds(): Set<string> {
	try {
		const raw = localStorage.getItem(READ_EVENTS_STORAGE_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		return new Set(Array.isArray(parsed) ? parsed : []);
	} catch {
		return new Set();
	}
}

function markEventsAsRead(eventIds: string[]): void {
	try {
		const existing = getReadEventIds();
		for (const id of eventIds) existing.add(id);
		const arr = Array.from(existing).slice(-MAX_STORED_READ_IDS);
		localStorage.setItem(READ_EVENTS_STORAGE_KEY, JSON.stringify(arr));
	} catch {}
}

type View = "list" | "add" | "detail";

export type SocialTraySelectedEventMeta = {
	username: string;
	isOwn: boolean;
	ownAvatarUrl: string | null;
	avatarSettings: Friend["avatarSettings"] | null;
};

export type SocialTrayTopHeaderState =
	| {
			kind: "event";
			username: string;
			isOwn: boolean;
			ownAvatarUrl: string | null;
			avatarSettings: Friend["avatarSettings"] | null;
			onBack: () => void;
	  }
	| {
			kind: "friend";
			username: string;
			avatarSettings: Friend["avatarSettings"] | null;
			onBack: () => void;
	  };

function timeAgo(timestampMs: number): string {
	const diffMs = Date.now() - timestampMs;
	if (!Number.isFinite(diffMs) || diffMs < 0) return "Just now";
	const minutes = Math.floor(diffMs / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function eventImageSrc(event: SharedEvent): string | null {
	const path = event.originalPath ?? event.thumbnailPath;
	return path ? `local-file://${path}` : null;
}

function toDaylineSlots(snapshot: DayWrappedSnapshot): DaylineSlot[] {
	return snapshot.slots.slice(0, SLOTS_PER_DAY).map((s) => ({
		startMs: s.startMs,
		count: s.count,
		category: toCategory(s.category),
		addiction: s.addiction,
		appName: s.appName,
	}));
}

export function SocialTray({
	selectedEvent: selectedEventProp,
	onSelectedEventChange,
	onSelectedEventMetaChange,
	onTopHeaderChange,
	useExternalHeader = false,
}: {
	selectedEvent?: SharedEvent | null;
	onSelectedEventChange?: (event: SharedEvent | null) => void;
	onSelectedEventMetaChange?: (
		meta: SocialTraySelectedEventMeta | null,
	) => void;
	onTopHeaderChange?: (state: SocialTrayTopHeaderState | null) => void;
	useExternalHeader?: boolean;
} = {}) {
	const [view, setView] = useState<View>("list");
	const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
	const [internalSelectedEvent, setInternalSelectedEvent] =
		useState<SharedEvent | null>(null);

	const [identity, setIdentity] = useState<SocialIdentity | null>(null);
	const [friends, setFriends] = useState<Friend[]>([]);
	const [pendingFriendRequests, setPendingFriendRequests] = useState<
		FriendRequest[]
	>([]);
	const [roomInvites, setRoomInvites] = useState<RoomInvite[]>([]);
	const [feed, setFeed] = useState<SharedEvent[]>([]);
	const [readEventIds, setReadEventIds] = useState<Set<string>>(() =>
		getReadEventIds(),
	);
	const [localEventPaths, setLocalEventPaths] = useState<
		Map<string, string | null>
	>(new Map());

	const [selectedDayWrapped, setSelectedDayWrapped] =
		useState<DayWrappedSnapshot | null>(null);
	const [daylineMode, setDaylineMode] = useState<DaylineViewMode>("categories");
	const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());

	const [isBusy, setIsBusy] = useState(false);

	const [registerUsername, setRegisterUsername] = useState("");
	const [registerError, setRegisterError] = useState<string | null>(null);

	const [addFriendUsername, setAddFriendUsername] = useState("");
	const [addFriendError, setAddFriendError] = useState<string | null>(null);

	const [replyText, setReplyText] = useState("");
	const [commentText, setCommentText] = useState("");
	const [commentThreadId, setCommentThreadId] = useState<string | null>(null);
	const [commentMessages, setCommentMessages] = useState<ChatMessage[]>([]);
	const [commentError, setCommentError] = useState<string | null>(null);
	const lastCommentTimestampRef = useRef<number>(0);

	const { settings } = useSettings();

	const selectedEvent =
		selectedEventProp !== undefined ? selectedEventProp : internalSelectedEvent;
	const setSelectedEvent = onSelectedEventChange ?? setInternalSelectedEvent;

	const myAvatarUrl = useMemo(() => {
		if (!identity) return null;
		const letter = identity.username.charAt(0).toUpperCase();
		return generateAvatarDataUrl(
			letter,
			96,
			settings.avatar ?? getDefaultAvatarSettings(),
		);
	}, [identity, settings.avatar]);

	useEffect(() => {
		if (!selectedEvent) {
			setCommentText("");
			setCommentMessages([]);
			setCommentThreadId(null);
			setCommentError(null);
		}
	}, [selectedEvent]);

	useEffect(() => {
		lastCommentTimestampRef.current =
			commentMessages.length > 0
				? (commentMessages[commentMessages.length - 1]?.timestampMs ?? 0)
				: 0;
	}, [commentMessages]);

	// Live-refresh comments while the event detail is open.
	useEffect(() => {
		if (!window.api?.chat) return;
		if (!selectedEvent || !commentThreadId) return;

		let cancelled = false;
		let inFlight = false;

		const poll = async () => {
			if (cancelled) return;
			if (inFlight) return;
			inFlight = true;
			try {
				const baseSince = Math.max(
					0,
					selectedEvent.timestampMs - 7 * 24 * 60 * 60 * 1000,
				);
				const since = Math.max(baseSince, lastCommentTimestampRef.current);
				const next = await window.api.chat.fetchMessages(
					commentThreadId,
					since,
				);
				if (cancelled) return;
				if (next.length > 0) {
					setCommentMessages((prev) => [...prev, ...next]);
					const lastTs =
						next[next.length - 1]?.timestampMs ??
						lastCommentTimestampRef.current ??
						Date.now();
					try {
						await window.api.chat.markThreadRead(commentThreadId, lastTs);
					} catch {}
				}
				setCommentError(null);
			} catch (e) {
				if (cancelled) return;
				setCommentError(String(e));
			} finally {
				inFlight = false;
			}
		};

		// Poll quickly while open so it feels real-time-ish.
		const interval = setInterval(() => void poll(), 5_000);
		void poll();

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [commentThreadId, selectedEvent]);

	useEffect(() => {
		if (!onSelectedEventMetaChange) return;
		if (!selectedEvent || !identity) {
			onSelectedEventMetaChange(null);
			return;
		}
		const isOwn = selectedEvent.authorUserId === identity.userId;
		const avatarSettings =
			friends.find((f) => f.userId === selectedEvent.authorUserId)
				?.avatarSettings ?? null;
		onSelectedEventMetaChange({
			username: selectedEvent.authorUsername,
			isOwn,
			ownAvatarUrl: myAvatarUrl,
			avatarSettings,
		});
	}, [
		friends,
		identity,
		myAvatarUrl,
		onSelectedEventMetaChange,
		selectedEvent,
	]);

	const refresh = useCallback(async () => {
		if (!window.api?.social) return;

		try {
			const id = await window.api.social.getIdentity();
			setIdentity(id);

			if (!id) {
				setFriends([]);
				setPendingFriendRequests([]);
				setRoomInvites([]);
				setFeed([]);
				return;
			}

			const [f, friendReqs, invites, feedData] = await Promise.all([
				window.api.social.listFriends(),
				window.api.social.listFriendRequests(),
				window.api.rooms.listInvites(),
				window.api.socialFeed.getFeed({ limit: 200, includeOwnEvents: true }),
			]);

			setFriends(f);
			setPendingFriendRequests(
				friendReqs.filter((r) => r.status === "pending"),
			);
			setRoomInvites(invites);
			setFeed(feedData);
		} catch (e) {
			console.error(e);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const interval = setInterval(() => void refresh(), 10_000);
		return () => clearInterval(interval);
	}, [refresh]);

	useEffect(() => {
		if (!identity || !feed.length) return;

		const ownEventIds = feed
			.filter((e) => e.authorUserId === identity.userId && !eventImageSrc(e))
			.map((e) => e.id);

		if (ownEventIds.length === 0) return;

		const fetchLocalPaths = async () => {
			const pathMap = new Map<string, string | null>();
			for (const id of ownEventIds) {
				try {
					const localEvent = await window.api.storage.getEvent(id);
					if (localEvent?.originalPath) {
						pathMap.set(id, `local-file://${localEvent.originalPath}`);
					} else if (localEvent?.thumbnailPath) {
						pathMap.set(id, `local-file://${localEvent.thumbnailPath}`);
					}
				} catch {}
			}
			if (pathMap.size > 0) {
				setLocalEventPaths((prev) => {
					const next = new Map(prev);
					for (const [k, v] of pathMap) next.set(k, v);
					return next;
				});
			}
		};

		void fetchLocalPaths();
	}, [identity, feed]);

	const cycleProfileMode = useCallback(() => {
		setDaylineMode((m) => {
			const idx = VIEW_MODE_ORDER.indexOf(m);
			return VIEW_MODE_ORDER[(idx + 1) % VIEW_MODE_ORDER.length];
		});
	}, []);

	const handleLabelToggle = useCallback((label: string) => {
		setSelectedLabels((prev) => {
			const next = new Set(prev);
			if (next.has(label)) next.delete(label);
			else next.add(label);
			return next;
		});
	}, []);

	const selectedFriendSlots = useMemo(
		() => (selectedDayWrapped ? toDaylineSlots(selectedDayWrapped) : []),
		[selectedDayWrapped],
	);

	const selectedFriendUpdatedLabel = useMemo(() => {
		if (!selectedDayWrapped) return null;
		return `Updated ${timeAgo(selectedDayWrapped.publishedAtMs)}`;
	}, [selectedDayWrapped]);

	const openFriend = useCallback(async (friend: Friend) => {
		setSelectedFriend(friend);
		setSelectedDayWrapped(null);
		setSelectedLabels(new Set());
		setDaylineMode("categories");
		setView("detail");

		try {
			const snapshot = await window.api.socialFeed.getFriendDayWrapped(
				friend.userId,
			);
			setSelectedDayWrapped(snapshot);
		} catch {}
	}, []);

	const openEvent = useCallback(
		async (event: SharedEvent) => {
			if (!identity) return;
			setSelectedEvent(event);
			setCommentText("");
			setCommentMessages([]);
			setCommentThreadId(null);
			setCommentError(null);

			try {
				try {
					const localEvent = await window.api.storage.getEvent(event.id);
					const localPath =
						localEvent?.originalPath ?? localEvent?.thumbnailPath;
					if (localPath) {
						setLocalEventPaths((prev) => {
							const next = new Map(prev);
							next.set(event.id, `local-file://${localPath}`);
							return next;
						});
					}
				} catch {}
				const threadId = await window.api.chat.openProjectThread(event.roomId);
				setCommentThreadId(threadId);
				const since = Math.max(0, event.timestampMs - 7 * 24 * 60 * 60 * 1000);
				const messages = await window.api.chat.fetchMessages(threadId, since);
				setCommentMessages(messages);
				const lastTs = messages.length
					? (messages[messages.length - 1]?.timestampMs ?? Date.now())
					: Date.now();
				try {
					await window.api.chat.markThreadRead(threadId, lastTs);
				} catch {}
			} catch (e) {
				setCommentError(String(e));
			}
		},
		[identity, setSelectedEvent],
	);

	const sendComment = useCallback(async () => {
		if (!selectedEvent || !commentThreadId || !identity) return;
		const text = commentText.trim();
		if (!text) return;
		setIsBusy(true);
		try {
			await window.api.chat.sendMessage(
				commentThreadId,
				encodeEventComment(selectedEvent.id, text),
			);
			setCommentText("");
			const since =
				commentMessages.length > 0
					? (commentMessages[commentMessages.length - 1]?.timestampMs ?? 0)
					: Math.max(0, selectedEvent.timestampMs - 7 * 24 * 60 * 60 * 1000);
			const next = await window.api.chat.fetchMessages(commentThreadId, since);
			setCommentMessages((prev) => [...prev, ...next]);
		} catch (e) {
			setCommentError(String(e));
		} finally {
			setIsBusy(false);
		}
	}, [selectedEvent, commentMessages, commentText, commentThreadId, identity]);

	const closeFriend = useCallback(() => {
		setSelectedFriend(null);
		setSelectedDayWrapped(null);
		setReplyText("");
		setSelectedLabels(new Set());
		setDaylineMode("categories");
		setView("list");
	}, []);

	useEffect(() => {
		if (!onTopHeaderChange) return;

		if (selectedEvent && identity) {
			const isOwn = selectedEvent.authorUserId === identity.userId;
			const avatarSettings =
				friends.find((f) => f.userId === selectedEvent.authorUserId)
					?.avatarSettings ?? null;

			onTopHeaderChange({
				kind: "event",
				username: selectedEvent.authorUsername,
				isOwn,
				ownAvatarUrl: myAvatarUrl,
				avatarSettings,
				onBack: () => setSelectedEvent(null),
			});
			return;
		}

		if (!selectedEvent && view === "detail" && selectedFriend) {
			onTopHeaderChange({
				kind: "friend",
				username: selectedFriend.username,
				avatarSettings: selectedFriend.avatarSettings,
				onBack: closeFriend,
			});
			return;
		}

		onTopHeaderChange(null);
	}, [
		closeFriend,
		friends,
		identity,
		myAvatarUrl,
		onTopHeaderChange,
		selectedEvent,
		selectedFriend,
		setSelectedEvent,
		view,
	]);

	const incomingFriendRequests = useMemo(() => {
		if (!identity) return [];
		return pendingFriendRequests.filter((r) => r.toUserId === identity.userId);
	}, [identity, pendingFriendRequests]);

	const latestActivityByUserId = useMemo(() => {
		const map = new Map<
			string,
			{ timestampMs: number; category: string | null }
		>();
		for (const e of feed) {
			const prev = map.get(e.authorUserId);
			if (!prev || e.timestampMs > prev.timestampMs) {
				map.set(e.authorUserId, {
					timestampMs: e.timestampMs,
					category: e.category,
				});
			}
		}
		return map;
	}, [feed]);

	const { newEvents, oldEvents } = useMemo(() => {
		const newOnes: SharedEvent[] = [];
		const oldOnes: SharedEvent[] = [];
		for (const e of feed) {
			if (readEventIds.has(e.id)) {
				oldOnes.push(e);
			} else {
				newOnes.push(e);
			}
		}
		return { newEvents: newOnes, oldEvents: oldOnes };
	}, [feed, readEventIds]);

	useEffect(() => {
		if (newEvents.length === 0) return;
		const timer = setTimeout(() => {
			const ids = newEvents.map((e) => e.id);
			markEventsAsRead(ids);
			setReadEventIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) next.add(id);
				return next;
			});
		}, 3000);
		return () => clearTimeout(timer);
	}, [newEvents]);

	const handleRegister = useCallback(async () => {
		if (!window.api?.social) return;
		const username = registerUsername.trim();
		if (!username) return;

		setIsBusy(true);
		setRegisterError(null);
		try {
			await window.api.social.registerUsername(username);
			setRegisterUsername("");
			await refresh();
		} catch (e) {
			setRegisterError(String(e));
		} finally {
			setIsBusy(false);
		}
	}, [registerUsername, refresh]);

	const handleSendFriendRequest = useCallback(async () => {
		if (!window.api?.social) return;
		const username = addFriendUsername.trim();
		if (!username) return;

		setIsBusy(true);
		setAddFriendError(null);
		try {
			await window.api.social.sendFriendRequest(username);
			setAddFriendUsername("");
			setView("list");
			await refresh();
		} catch (e) {
			setAddFriendError(String(e));
		} finally {
			setIsBusy(false);
		}
	}, [addFriendUsername, refresh]);

	const handleAcceptFriendRequest = useCallback(
		async (requestId: string) => {
			if (!window.api?.social) return;
			setIsBusy(true);
			try {
				await window.api.social.acceptFriendRequest(requestId);
				await window.api.socialFeed.ensureFriendsFeedRoom();
				await refresh();
			} finally {
				setIsBusy(false);
			}
		},
		[refresh],
	);

	const handleRejectFriendRequest = useCallback(
		async (requestId: string) => {
			if (!window.api?.social) return;
			setIsBusy(true);
			try {
				await window.api.social.rejectFriendRequest(requestId);
				await refresh();
			} finally {
				setIsBusy(false);
			}
		},
		[refresh],
	);

	const handleAcceptRoomInvite = useCallback(
		async (invite: RoomInvite) => {
			setIsBusy(true);
			try {
				await window.api.rooms.acceptProjectInvite({
					roomId: invite.roomId,
					roomName: invite.roomName,
					ownerUserId: invite.fromUserId,
					ownerUsername: invite.fromUsername,
				});
				await refresh();
			} finally {
				setIsBusy(false);
			}
		},
		[refresh],
	);

	if (!identity) {
		return (
			<div className="flex h-[400px] flex-col items-center justify-center p-6 text-center space-y-4">
				<div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
					<Activity className="h-6 w-6 text-primary" />
				</div>
				<div className="space-y-1">
					<h3 className="text-sm font-medium">Create your identity</h3>
					<p className="text-xs text-muted-foreground max-w-[200px] mx-auto">
						Choose a unique username to connect with friends and share your day.
					</p>
				</div>
				<div className="w-full max-w-[240px] space-y-2">
					<Input
						value={registerUsername}
						onChange={(e) => setRegisterUsername(e.target.value)}
						placeholder="username"
						className="text-center text-sm"
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
					/>
					<Button
						className="w-full"
						size="sm"
						onClick={handleRegister}
						disabled={isBusy || !registerUsername.trim()}
					>
						{isBusy ? "Creating..." : "Get Started"}
					</Button>
					{registerError && (
						<div className="text-[10px] text-destructive mt-2">
							{registerError}
						</div>
					)}
				</div>
			</div>
		);
	}

	if (selectedEvent) {
		return (
			<div className="relative h-[400px] w-full overflow-hidden">
				<SharedEventDetail
					event={selectedEvent}
					identity={identity}
					friends={friends}
					commentMessages={commentMessages}
					commentText={commentText}
					onCommentTextChange={setCommentText}
					onSendComment={() => void sendComment()}
					isBusy={isBusy}
					commentError={commentError}
					localEventPaths={localEventPaths}
				/>
			</div>
		);
	}

	return (
		<div className="relative h-[400px] w-full overflow-hidden">
			<AnimatePresence initial={false} mode="popLayout">
				{view === "list" ? (
					<motion.div
						key="list"
						initial={{ x: -20, opacity: 0 }}
						animate={{ x: 0, opacity: 1 }}
						exit={{ x: -20, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="absolute inset-0 flex flex-col"
					>
						{incomingFriendRequests.length > 0 && (
							<div className="mb-3 space-y-2">
								<div className="text-[9px] font-mono tracking-[0.2em] text-muted-foreground">
									REQUESTS
								</div>
								{incomingFriendRequests.map((req) => (
									<div
										key={req.id}
										className="flex items-center justify-between rounded-lg bg-muted/10 px-3 py-2"
									>
										<span className="text-xs text-foreground">
											@{req.fromUsername}
										</span>
										<div className="flex gap-1">
											<Button
												size="sm"
												variant="ghost"
												className="h-6 px-2 text-xs hover:bg-emerald-500/20 hover:text-emerald-500"
												onClick={() => handleAcceptFriendRequest(req.id)}
												disabled={isBusy}
											>
												Accept
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="h-6 px-2 text-xs hover:bg-destructive/20 hover:text-destructive"
												onClick={() => handleRejectFriendRequest(req.id)}
												disabled={isBusy}
											>
												Reject
											</Button>
										</div>
									</div>
								))}
							</div>
						)}

						{roomInvites.length > 0 && (
							<div className="mb-3 space-y-2">
								<div className="text-[9px] font-mono tracking-[0.2em] text-muted-foreground">
									INVITES
								</div>
								{roomInvites.map((inv) => (
									<div
										key={inv.id}
										className="flex items-center justify-between rounded-lg bg-muted/10 px-3 py-2"
									>
										<div className="flex flex-col">
											<span className="text-xs text-foreground">
												{inv.roomName}
											</span>
											<span className="text-[10px] text-muted-foreground">
												from @{inv.fromUsername}
											</span>
										</div>
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2 text-xs hover:bg-primary/10 hover:text-primary"
											onClick={() => handleAcceptRoomInvite(inv)}
											disabled={isBusy}
										>
											Join
										</Button>
									</div>
								))}
							</div>
						)}

						<div className="flex items-center gap-2 mb-4 pb-1 border-b border-border/40">
							<div className="flex-1 flex gap-3 overflow-x-auto scrollbar-hide">
								{friends.map((friend) => {
									const activity = latestActivityByUserId.get(friend.userId);
									return (
										<FriendAvatarItem
											key={friend.userId}
											friend={friend}
											lastActivity={activity ?? null}
											onClick={() => void openFriend(friend)}
										/>
									);
								})}
							</div>
							<Button
								variant="ghost"
								size="icon"
								className="size-6 items-center mr-0.5 justify-center shrink-0 rounded-full hover:bg-muted/20"
								onClick={() => setView("add")}
							>
								<Plus className="size-3 text-muted-foreground" />
							</Button>
						</div>

						<div className="flex-1 overflow-y-auto space-y-3 -mr-2 pr-2 custom-scrollbar">
							{feed.length === 0 ? (
								<div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
									<Activity className="h-8 w-8 opacity-20" />
									<span>No recent activity</span>
								</div>
							) : (
								<>
									{newEvents.map((item) => (
										<SharedEventCard
											key={item.id}
											item={item}
											onClick={() => void openEvent(item)}
											isOwnEvent={item.authorUserId === identity?.userId}
											localImageSrc={localEventPaths.get(item.id)}
											ownAvatarUrl={myAvatarUrl}
										/>
									))}
									{newEvents.length > 0 && oldEvents.length > 0 && (
										<div className="flex items-center gap-2 py-1">
											<div className="flex-1 border-t border-border/40" />
											<span className="text-[9px] font-mono tracking-[0.2em] text-muted-foreground/60">
												SEEN
											</span>
											<div className="flex-1 border-t border-border/40" />
										</div>
									)}
									{oldEvents.map((item) => (
										<SharedEventCard
											key={item.id}
											item={item}
											onClick={() => void openEvent(item)}
											isOwnEvent={item.authorUserId === identity?.userId}
											localImageSrc={localEventPaths.get(item.id)}
											ownAvatarUrl={myAvatarUrl}
										/>
									))}
								</>
							)}
						</div>
					</motion.div>
				) : view === "add" ? (
					<motion.div
						key="add"
						initial={{ x: 20, opacity: 0 }}
						animate={{ x: 0, opacity: 1 }}
						exit={{ x: 20, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="absolute inset-0 flex flex-col"
					>
						<div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40">
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 -ml-2 rounded-full hover:bg-muted/20"
								onClick={() => {
									setView("list");
									setAddFriendUsername("");
									setAddFriendError(null);
								}}
							>
								<ChevronLeft className="h-4 w-4 text-muted-foreground" />
							</Button>
							<div className="text-sm font-medium">Add Friend</div>
							<div className="w-6" />
						</div>

						<div className="flex-1 flex flex-col items-center justify-center p-5">
							<div className="h-12 w-12 rounded-full flex items-center justify-center mb-2">
								<UserPlus className="h-6 w-6 text-primary" />
							</div>
							<p className="text-xs text-muted-foreground mb-4 text-center max-w-[200px]">
								Enter your friend's username to send them a request.
							</p>
							<div className="w-full max-w-[240px] space-y-3">
								<Input
									value={addFriendUsername}
									onChange={(e) => setAddFriendUsername(e.target.value)}
									placeholder="username"
									className="text-center text-xs"
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void handleSendFriendRequest();
										}
									}}
								/>
								<Button
									className="w-full"
									size="sm"
									onClick={() => void handleSendFriendRequest()}
									disabled={isBusy || !addFriendUsername.trim()}
								>
									{isBusy ? "Sending..." : "Send Request"}
								</Button>
								{addFriendError && (
									<div className="text-[10px] text-destructive text-center">
										{addFriendError}
									</div>
								)}
							</div>
						</div>
					</motion.div>
				) : (
					<motion.div
						key="detail"
						initial={{ x: 20, opacity: 0 }}
						animate={{ x: 0, opacity: 1 }}
						exit={{ x: 20, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="absolute inset-0 flex flex-col"
					>
						{selectedFriend && (
							<PersonView
								friend={selectedFriend}
								showBackHeader={!useExternalHeader}
								onBack={closeFriend}
								showIdentityRow={!useExternalHeader}
								dayWrapped={selectedDayWrapped}
								updatedLabel={selectedFriendUpdatedLabel}
								slots={selectedFriendSlots}
								daylineMode={daylineMode}
								onCycleDaylineMode={cycleProfileMode}
								selectedLabels={selectedLabels}
								onLabelToggle={handleLabelToggle}
								sharedEvents={feed.filter(
									(e) => e.authorUserId === selectedFriend.userId,
								)}
								onOpenEvent={openEvent}
								replyText={replyText}
								onReplyTextChange={setReplyText}
								renderEventCard={(event, onClick) => (
									<SharedEventCard
										key={event.id}
										item={event}
										onClick={onClick}
									/>
								)}
							/>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function getCategoryIndicatorColor(category: string | null): string {
	const cat = toCategory(category);
	const rgb = CATEGORY_RGB[cat];
	return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function FriendAvatarItem({
	friend,
	lastActivity,
	onClick,
}: {
	friend: Friend;
	lastActivity: { timestampMs: number; category: string | null } | null;
	onClick: () => void;
}) {
	const indicatorColor = useMemo(() => {
		if (!lastActivity) return getCategoryIndicatorColor(null);
		return getCategoryIndicatorColor(lastActivity.category);
	}, [lastActivity]);

	return (
		<button type="button" onClick={onClick} className="relative shrink-0">
			<AvatarDisplay
				userId={friend.userId}
				username={friend.username}
				size="md"
				avatarSettings={friend.avatarSettings}
			/>
			<div
				className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background"
				style={{ backgroundColor: indicatorColor }}
			/>
		</button>
	);
}

function SharedEventCard({
	item,
	onClick,
	isOwnEvent,
	localImageSrc,
	ownAvatarUrl,
}: {
	item: SharedEvent;
	onClick: () => void;
	isOwnEvent?: boolean;
	localImageSrc?: string | null;
	ownAvatarUrl?: string | null;
}) {
	const imageSrc = useMemo(
		() => localImageSrc ?? eventImageSrc(item),
		[item, localImageSrc],
	);
	const indicatorColor = useMemo(
		() => getCategoryIndicatorColor(item.category),
		[item.category],
	);

	const backgroundItem = item.background?.[0];

	return (
		<button
			type="button"
			className="group relative w-full text-left overflow-hidden rounded-xl bg-card border border-border/40 hover:border-primary/20 hover:shadow-sm transition-all duration-200 cursor-pointer"
			onClick={onClick}
		>
			<div className="aspect-[16/9] w-full bg-muted/10 relative border-b border-border/40">
				{imageSrc ? (
					<img
						src={imageSrc}
						alt=""
						className="absolute inset-0 h-full w-full object-cover"
					/>
				) : (
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="text-[10px] text-muted-foreground opacity-50 uppercase tracking-widest font-mono">
							Screenshot
						</div>
					</div>
				)}

				{item.category && (
					<div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-[9px] font-medium text-white/90 shadow-sm">
						{item.category}
					</div>
				)}
			</div>

			<div className="p-3 space-y-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<div className="relative">
							<AvatarDisplay
								userId={item.authorUserId}
								username={item.authorUsername}
								size="sm"
								isOwn={isOwnEvent}
								ownAvatarUrl={ownAvatarUrl}
								className=""
							/>
							<div
								className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background"
								style={{ backgroundColor: indicatorColor }}
							/>
						</div>
						<div className="flex flex-col">
							<span className="text-xs font-semibold text-foreground">
								{isOwnEvent ? "You" : `@${item.authorUsername}`}
							</span>
							<span className="text-[10px] text-muted-foreground">
								{timeAgo(item.timestampMs)}
							</span>
						</div>
					</div>

					{item.appName && (
						<div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground bg-muted/30 px-2 py-1 rounded-md border border-border/20">
							<AppWindow className="h-3 w-3 opacity-70" />
							{item.appName}
						</div>
					)}
				</div>

				{(item.caption ||
					item.contentTitle ||
					item.windowTitle ||
					item.project) && (
					<div className="space-y-1">
						{item.project && (
							<div className="text-[10px] font-mono uppercase tracking-wider text-primary/80">
								{item.project}
							</div>
						)}
						<div className="text-xs text-foreground/90 leading-relaxed font-medium">
							{item.caption || item.contentTitle || item.windowTitle}
						</div>
					</div>
				)}

				{backgroundItem && (
					<div className="mt-2 pt-2 border-t border-border/40">
						<div className="flex items-center gap-2 group/bg">
							{backgroundItem.imageUrl ? (
								<img
									src={backgroundItem.imageUrl}
									alt={backgroundItem.title ?? ""}
									className="h-8 w-8 rounded-md object-cover shadow-sm border border-border/20"
								/>
							) : (
								<div className="h-8 w-8 rounded-md bg-muted/20 flex items-center justify-center border border-border/20">
									<Music className="h-3.5 w-3.5 text-muted-foreground" />
								</div>
							)}
							<div className="flex flex-col min-w-0">
								{/* <div className="flex items-center gap-1.5">
									<span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono">
										Listening to
									</span>
								</div> */}
								<span className="text-xs font-medium text-foreground truncate">
									{backgroundItem.title || "Unknown Track"}
								</span>
								{backgroundItem.subtitle && (
									<span className="text-[10px] text-muted-foreground truncate font-mono uppercase">
										{backgroundItem.subtitle}
									</span>
								)}
							</div>
						</div>
					</div>
				)}
			</div>
		</button>
	);
}
