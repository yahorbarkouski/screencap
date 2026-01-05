import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	AppWindow,
	ChevronLeft,
	Expand,
	ExternalLink,
	Flame,
	Globe,
	Music,
	Plus,
	SendHorizontal,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { encodeEventComment, parseEventComment } from "@/lib/socialComments";
import type {
	ChatMessage,
	DayWrappedSnapshot,
	Friend,
	FriendRequest,
	RoomInvite,
	SharedEvent,
	SocialIdentity,
} from "@/types";
import {
	Dayline,
	DaylineTimeMarkers,
	type DaylineViewMode,
	DayWrappedLegend,
	VIEW_MODE_ORDER,
} from "./Dayline";

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

function initials(username: string): string {
	const trimmed = username.trim();
	if (!trimmed) return "??";
	return trimmed.slice(0, 2).toUpperCase();
}

function AvatarDisplay({
	username,
	size,
	isOwn,
	ownAvatarUrl,
	avatarSettings,
	className,
}: {
	username: string;
	size: "xs" | "sm" | "md" | "lg";
	isOwn?: boolean;
	ownAvatarUrl?: string | null;
	avatarSettings?: {
		pattern: string;
		backgroundColor: string;
		foregroundColor: string;
	} | null;
	className?: string;
}) {
	const sizeClasses = {
		xs: "h-5 w-5 text-[9px]",
		sm: "h-6 w-6 text-[10px]",
		md: "h-9 w-9 text-xs",
		lg: "h-12 w-12 text-lg",
	};
	const sizePx = { xs: 20, sm: 24, md: 36, lg: 48 };

	const avatarUrl = useMemo(() => {
		if (isOwn && ownAvatarUrl) return ownAvatarUrl;
		if (avatarSettings) {
			const letter = username.charAt(0).toUpperCase();
			return generateAvatarDataUrl(
				letter,
				sizePx[size] * 2,
				avatarSettings as Parameters<typeof generateAvatarDataUrl>[2],
			);
		}
		return null;
	}, [isOwn, ownAvatarUrl, avatarSettings, username, size]);

	if (avatarUrl) {
		return (
			<div
				className={`${sizeClasses[size]} shrink-0 rounded-lg overflow-hidden border border-primary/40 ${className ?? ""}`}
			>
				<img
					src={avatarUrl}
					alt={username}
					className="h-full w-full object-cover"
				/>
			</div>
		);
	}

	return (
		<div
			className={`${sizeClasses[size]} shrink-0 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center font-medium text-foreground/80 ${className ?? ""}`}
		>
			{initials(username)}
		</div>
	);
}

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
	const path = event.thumbnailPath ?? event.originalPath;
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

export function SocialTray() {
	const [view, setView] = useState<View>("list");
	const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
	const [selectedEvent, setSelectedEvent] = useState<SharedEvent | null>(null);

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

	const { settings } = useSettings();

	const myAvatarUrl = useMemo(() => {
		if (!identity) return null;
		const letter = identity.username.charAt(0).toUpperCase();
		return generateAvatarDataUrl(
			letter,
			96,
			settings.avatar ?? getDefaultAvatarSettings(),
		);
	}, [identity, settings.avatar]);

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
					if (localEvent?.thumbnailPath) {
						pathMap.set(id, `local-file://${localEvent.thumbnailPath}`);
					} else if (localEvent?.originalPath) {
						pathMap.set(id, `local-file://${localEvent.originalPath}`);
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
				const threadId = await window.api.chat.openProjectThread(event.roomId);
				setCommentThreadId(threadId);
				const since = Math.max(0, event.timestampMs - 7 * 24 * 60 * 60 * 1000);
				const messages = await window.api.chat.fetchMessages(threadId, since);
				setCommentMessages(messages);
			} catch (e) {
				setCommentError(String(e));
			}
		},
		[identity],
	);

	const closeEvent = useCallback(() => {
		setSelectedEvent(null);
		setCommentText("");
		setCommentMessages([]);
		setCommentThreadId(null);
		setCommentError(null);
	}, []);

	const expandEventImage = useCallback(
		async (event: SharedEvent) => {
			// Merge local image path into event for preview
			const localSrc = localEventPaths.get(event.id);
			const eventWithLocalPath = localSrc
				? { ...event, originalPath: localSrc.replace("local-file://", "") }
				: event;
			await window.api?.app.previewEvent(eventWithLocalPath);
		},
		[localEventPaths],
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
		const usersById = new Map<string, string>();
		usersById.set(identity.userId, identity.username);
		for (const f of friends) usersById.set(f.userId, f.username);

		const parsedComments = commentMessages
			.map((m) => {
				const parsed = parseEventComment(m.text);
				if (!parsed || parsed.eventId !== selectedEvent.id) return null;
				return {
					id: m.id,
					authorUserId: m.authorUserId,
					authorUsername:
						usersById.get(m.authorUserId) ?? m.authorUserId.slice(0, 8),
					timestampMs: m.timestampMs,
					text: parsed.text,
				};
			})
			.filter((v): v is NonNullable<typeof v> => v !== null)
			.sort((a, b) => a.timestampMs - b.timestampMs);

		const eventImageSrcValue =
			localEventPaths.get(selectedEvent.id) ?? eventImageSrc(selectedEvent);
		const isOwnEvent = selectedEvent.authorUserId === identity.userId;
		const indicatorColor = getCategoryIndicatorColor(selectedEvent.category);

		return (
			<div className="relative h-[400px] w-full overflow-hidden">
				<div className="absolute inset-0 flex flex-col">
					<div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40">
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 -ml-2 rounded-full hover:bg-muted/20"
							onClick={closeEvent}
						>
							<ChevronLeft className="h-4 w-4 text-muted-foreground" />
						</Button>
						<div className="flex items-center gap-2">
							<div className="relative">
								<AvatarDisplay
									username={selectedEvent.authorUsername}
									size="xs"
									isOwn={isOwnEvent}
									ownAvatarUrl={myAvatarUrl}
								/>
								<div
									className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background"
									style={{ backgroundColor: indicatorColor }}
								/>
							</div>
							<span className="text-xs font-medium text-foreground/90">
								{isOwnEvent ? "You" : `@${selectedEvent.authorUsername}`}
							</span>
						</div>
						<div className="w-6" />
					</div>

					<div className="flex-1 overflow-y-auto -mr-2 pr-2 custom-scrollbar space-y-3 pb-4">
						<div className="group relative rounded-lg overflow-hidden bg-black/20">
							{eventImageSrcValue ? (
								<img
									src={eventImageSrcValue}
									alt=""
									className="w-full aspect-[2/1] object-cover"
								/>
							) : (
								<div className="w-full aspect-[2/1] flex items-center justify-center">
									<div className="text-[10px] text-muted-foreground opacity-50 uppercase tracking-widest font-mono">
										Screenshot
									</div>
								</div>
							)}
							<button
								type="button"
								className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
								onClick={() => void expandEventImage(selectedEvent)}
							>
								<Expand className="h-3.5 w-3.5 text-white" />
							</button>
						</div>

						{(selectedEvent.appName || selectedEvent.windowTitle) && (
							<div className="text-xs text-muted-foreground px-1">
								{selectedEvent.appName && (
									<span className="text-foreground/80">
										{selectedEvent.appName}
									</span>
								)}
								{selectedEvent.appName && selectedEvent.windowTitle && (
									<span className="mx-1">·</span>
								)}
								{selectedEvent.windowTitle && (
									<span className="opacity-70 truncate">
										{selectedEvent.windowTitle}
									</span>
								)}
							</div>
						)}

						{(selectedEvent.url || selectedEvent.background?.length > 0) && (
							<div className="flex flex-wrap gap-2 px-1">
								{selectedEvent.url && (
									<button
										type="button"
										className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/10 hover:bg-muted/20 transition-colors text-xs"
										onClick={() =>
											window.api?.app.openExternal(selectedEvent.url!)
										}
									>
										<Globe className="h-3 w-3 text-muted-foreground" />
										<span className="max-w-[120px] truncate text-foreground/80">
											{(() => {
												try {
													return new URL(selectedEvent.url).hostname;
												} catch {
													return selectedEvent.url;
												}
											})()}
										</span>
										<ExternalLink className="h-2.5 w-2.5 text-muted-foreground/50" />
									</button>
								)}
								{selectedEvent.background?.[0] && (
									<button
										type="button"
										className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/10 hover:bg-muted/20 transition-colors"
										onClick={() => {
											const item = selectedEvent.background[0];
											if (item?.actionUrl) {
												window.api?.app.openExternal(item.actionUrl);
											}
										}}
										disabled={!selectedEvent.background[0].actionUrl}
									>
										{selectedEvent.background[0].imageUrl ? (
											<img
												src={selectedEvent.background[0].imageUrl}
												alt=""
												className="h-6 w-6 rounded object-cover"
											/>
										) : (
											<div className="flex h-6 w-6 items-center justify-center rounded bg-muted/20">
												<Music className="h-3 w-3 text-muted-foreground" />
											</div>
										)}
										<div className="flex flex-col items-start text-left max-w-[140px]">
											<span className="text-[10px] font-medium leading-none truncate w-full">
												{selectedEvent.background[0].title}
											</span>
											{selectedEvent.background[0].subtitle && (
												<span className="text-[9px] text-muted-foreground truncate w-full">
													{selectedEvent.background[0].subtitle}
												</span>
											)}
										</div>
										{selectedEvent.background[0].actionUrl && (
											<ExternalLink className="h-2.5 w-2.5 text-muted-foreground/50 flex-shrink-0" />
										)}
									</button>
								)}
							</div>
						)}

						<div className="pt-3 border-t border-border/30">
							<div className="text-[9px] font-mono tracking-[0.2em] text-muted-foreground mb-3 px-1">
								COMMENTS
							</div>
							{commentError && (
								<div className="text-[10px] text-destructive px-1 mb-2">
									{commentError}
								</div>
							)}
							{parsedComments.length === 0 ? (
								<div className="text-xs text-muted-foreground text-center py-6">
									No comments yet
								</div>
							) : (
								<div className="space-y-2">
									{parsedComments.map((c) => (
										<div
											key={c.id}
											className="rounded-lg border border-border/40 bg-muted/5 px-3 py-2"
										>
											<div className="flex items-center justify-between">
												<div className="text-[10px] text-muted-foreground">
													@{c.authorUsername}
												</div>
												<div className="text-[10px] text-muted-foreground">
													{timeAgo(c.timestampMs)}
												</div>
											</div>
											<div className="text-xs text-foreground/90 mt-1">
												{c.text}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					<div className="pt-3 border-t border-border/40">
						<div className="relative flex items-center">
							<Input
								value={commentText}
								onChange={(e) => setCommentText(e.target.value)}
								placeholder="Write a comment…"
								className="pr-8 h-9 text-xs bg-muted/10 border-transparent focus-visible:bg-muted/20 focus-visible:ring-0 placeholder:text-muted-foreground/50"
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										void sendComment();
									}
								}}
							/>
							<Button
								size="icon"
								variant="ghost"
								className="absolute right-1 h-6 w-6 rounded-full hover:bg-primary/10 hover:text-primary"
								disabled={!commentText.trim() || isBusy || !commentThreadId}
								onClick={() => void sendComment()}
							>
								<SendHorizontal className="h-3 w-3" />
							</Button>
						</div>
					</div>
				</div>
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

						<div className="flex items-center gap-2 mb-4 pb-2 border-b border-border/40">
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
								className="h-8 w-8 shrink-0 rounded-full hover:bg-muted/20"
								onClick={() => setView("add")}
							>
								<Plus className="h-4 w-4 text-muted-foreground" />
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
						<FriendProfile
							friend={selectedFriend}
							onBack={closeFriend}
							dayWrapped={selectedDayWrapped}
							daylineMode={daylineMode}
							onCycleDaylineMode={cycleProfileMode}
							selectedLabels={selectedLabels}
							onLabelToggle={handleLabelToggle}
							sharedEvents={feed.filter(
								(e) => e.authorUserId === selectedFriend?.userId,
							)}
							onOpenEvent={openEvent}
							replyText={replyText}
							onReplyTextChange={setReplyText}
						/>
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

	return (
		<button
			type="button"
			className="group relative w-full text-left overflow-hidden rounded-lg bg-muted/5 border border-border/40 hover:bg-muted/10 transition-all cursor-pointer"
			onClick={onClick}
		>
			<div className="aspect-[2/1] w-full bg-muted/10 relative">
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
			</div>

			<div className="p-3 space-y-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="relative">
							<AvatarDisplay
								username={item.authorUsername}
								size="xs"
								isOwn={isOwnEvent}
								ownAvatarUrl={ownAvatarUrl}
							/>
							<div
								className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background"
								style={{ backgroundColor: indicatorColor }}
							/>
						</div>
						<span className="text-xs font-medium text-foreground/90 truncate">
							{isOwnEvent ? "You" : `@${item.authorUsername}`}
						</span>
					</div>
					{item.category && (
						<span className="text-[10px] font-mono text-muted-foreground">
							{item.category}
						</span>
					)}
				</div>

				{item.appName && (
					<div className="text-xs text-foreground/90 truncate">
						{item.appName}
					</div>
				)}

				{item.windowTitle && (
					<div className="text-xs text-muted-foreground truncate">
						{item.windowTitle}
					</div>
				)}
			</div>
		</button>
	);
}

function FriendProfile({
	friend,
	onBack,
	dayWrapped,
	daylineMode,
	onCycleDaylineMode,
	selectedLabels,
	onLabelToggle,
	sharedEvents,
	onOpenEvent,
	replyText,
	onReplyTextChange,
}: {
	friend: Friend | null;
	onBack: () => void;
	dayWrapped: DayWrappedSnapshot | null;
	daylineMode: DaylineViewMode;
	onCycleDaylineMode: () => void;
	selectedLabels: Set<string>;
	onLabelToggle: (label: string) => void;
	sharedEvents: SharedEvent[];
	onOpenEvent: (event: SharedEvent) => void;
	replyText: string;
	onReplyTextChange: (value: string) => void;
}) {
	const slots = useMemo(
		() => (dayWrapped ? toDaylineSlots(dayWrapped) : []),
		[dayWrapped],
	);

	if (!friend) return <div />;

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center pb-2 mb-2 border-b border-border/40">
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 -ml-2 rounded-full hover:bg-muted/20"
					onClick={onBack}
				>
					<ChevronLeft className="h-4 w-4 text-muted-foreground" />
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto -mr-2 pr-2 custom-scrollbar">
				<div className="flex items-center gap-3 mb-4 mt-1">
					<AvatarDisplay
						username={friend.username}
						size="lg"
						avatarSettings={friend.avatarSettings}
					/>
					<div className="flex flex-col min-w-0">
						<div className="text-sm font-medium text-foreground truncate">
							@{friend.username}
						</div>
						<div className="text-[10px] text-muted-foreground">
							{dayWrapped
								? `Updated ${timeAgo(dayWrapped.publishedAtMs)}`
								: "No Day Wrapped yet"}
						</div>
					</div>
				</div>

				<div className="mb-6">
					<div className="flex items-center justify-between mb-3 px-1">
						<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground">
							DAY WRAPPED
						</div>
						{dayWrapped && (
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 rounded-full hover:bg-muted/20"
								onClick={onCycleDaylineMode}
							>
								{daylineMode === "categories" && (
									<Activity className="h-3 w-3 text-muted-foreground" />
								)}
								{daylineMode === "apps" && (
									<AppWindow className="h-3 w-3 text-muted-foreground" />
								)}
								{daylineMode === "addiction" && (
									<Flame className="h-3 w-3 text-muted-foreground" />
								)}
							</Button>
						)}
					</div>

					{dayWrapped ? (
						<>
							<Dayline
								slots={slots}
								mode={daylineMode}
								selectedLabels={selectedLabels}
							/>
							<DaylineTimeMarkers
								slots={slots}
								mode={daylineMode}
								selectedLabels={selectedLabels}
							/>
							<DayWrappedLegend
								slots={slots}
								mode={daylineMode}
								selectedLabels={selectedLabels}
								onLabelToggle={onLabelToggle}
							/>
						</>
					) : (
						<div className="text-xs text-muted-foreground text-center py-6">
							Waiting for an update…
						</div>
					)}
				</div>

				<div className="space-y-3 mb-6">
					<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground px-1">
						ACTIVITY
					</div>
					{sharedEvents.length === 0 ? (
						<div className="text-xs text-muted-foreground text-center py-4">
							No recent activity
						</div>
					) : (
						sharedEvents.map((item) => (
							<SharedEventCard
								key={item.id}
								item={item}
								onClick={() => onOpenEvent(item)}
							/>
						))
					)}
				</div>
			</div>

			<div className="pt-3 border-t border-border/40">
				<div className="relative flex items-center">
					<Input
						value={replyText}
						onChange={(e) => onReplyTextChange(e.target.value)}
						placeholder={`Reply to @${friend.username}...`}
						className="pr-8 h-9 text-xs bg-muted/10 border-transparent focus-visible:bg-muted/20 focus-visible:ring-0 placeholder:text-muted-foreground/50"
					/>
					<Button
						size="icon"
						variant="ghost"
						className="absolute right-1 h-6 w-6 rounded-full hover:bg-primary/10 hover:text-primary"
						disabled={!replyText.trim()}
					>
						<SendHorizontal className="h-3 w-3" />
					</Button>
				</div>
			</div>
		</div>
	);
}
