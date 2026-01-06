import {
	AppWindow,
	Expand,
	ExternalLink,
	Globe,
	Music,
	SendHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImageBrightness } from "@/hooks/useImageBrightness";
import { parseEventComment } from "@/lib/socialComments";
import { cn } from "@/lib/utils";
import type { ChatMessage, Friend, SharedEvent, SocialIdentity } from "@/types";
import { AvatarDisplay } from "./AvatarDisplay";

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

function getCategoryOverlayColor(
	category: string | null,
	isLightBackground: boolean,
): string {
	const base = "backdrop-blur-sm";

	if (isLightBackground) {
		switch (category) {
			case "Study":
				return `${base} bg-blue-800/70 text-white font-medium`;
			case "Work":
				return `${base} bg-green-800/80 text-white font-medium`;
			case "Leisure":
				return `${base} bg-purple-800/70 text-white font-medium`;
			case "Chores":
				return `${base} bg-orange-600/70 text-orange-800 font-medium`;
			case "Social":
				return `${base} bg-pink-800/70 text-white font-medium`;
			default:
				return `${base} bg-gray-800/70 text-white font-medium`;
		}
	}

	switch (category) {
		case "Study":
			return `${base} bg-blue-900/60 text-blue-400`;
		case "Work":
			return `${base} bg-green-900/60 text-green-400`;
		case "Leisure":
			return `${base} bg-purple-900/80 text-purple-400`;
		case "Chores":
			return `${base} bg-orange-900/60 text-orange-400`;
		case "Social":
			return `${base} bg-pink-900/70 text-pink-400`;
		default:
			return `${base} bg-gray-900/60 text-gray-400`;
	}
}

interface SharedEventDetailProps {
	event: SharedEvent;
	identity: SocialIdentity | null;
	friends: Friend[];
	commentMessages: ChatMessage[];
	commentText: string;
	onCommentTextChange: (text: string) => void;
	onSendComment: () => void;
	isBusy: boolean;
	commentError: string | null;
	localEventPaths: Map<string, string | null>;
}

export function SharedEventDetail({
	event,
	identity,
	friends,
	commentMessages,
	commentText,
	onCommentTextChange,
	onSendComment,
	isBusy,
	commentError,
	localEventPaths,
}: SharedEventDetailProps) {
	const usersById = useMemo(() => {
		const map = new Map<string, string>();
		if (identity) map.set(identity.userId, identity.username);
		for (const f of friends) map.set(f.userId, f.username);
		return map;
	}, [identity, friends]);

	const parsedComments = useMemo(() => {
		return commentMessages
			.map((m) => {
				const parsed = parseEventComment(m.text);
				if (!parsed || parsed.eventId !== event.id) return null;
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
	}, [commentMessages, event.id, usersById]);

	const primaryImageSrc = useMemo(() => {
		const local = localEventPaths.get(event.id);
		if (local) return local;
		if (event.originalPath) return `local-file://${event.originalPath}`;
		if (event.thumbnailPath) return `local-file://${event.thumbnailPath}`;
		return null;
	}, [event.id, event.originalPath, event.thumbnailPath, localEventPaths]);

	const fallbackImageSrc = useMemo(() => {
		if (event.thumbnailPath) return `local-file://${event.thumbnailPath}`;
		if (event.originalPath) return `local-file://${event.originalPath}`;
		return null;
	}, [event.originalPath, event.thumbnailPath]);

	const fallbackRef = useRef<string | null>(null);
	const [imageSrc, setImageSrc] = useState<string | null>(primaryImageSrc);

	useEffect(() => {
		fallbackRef.current = fallbackImageSrc;
		setImageSrc(primaryImageSrc);
	}, [fallbackImageSrc, primaryImageSrc]);
	const brightnessImagePath = useMemo(() => {
		const local = localEventPaths.get(event.id);
		if (local?.startsWith("local-file://"))
			return local.replace("local-file://", "");
		return event.thumbnailPath ?? event.originalPath ?? null;
	}, [event.id, event.originalPath, event.thumbnailPath, localEventPaths]);
	const brightness = useImageBrightness(brightnessImagePath);
	const backgroundItem = event.background?.[0];
	const eventTitle =
		event.caption || event.contentTitle || event.windowTitle || "Screenshot";

	const expandEventImage = async () => {
		const localSrc = localEventPaths.get(event.id);
		const eventWithLocalPath = localSrc
			? { ...event, originalPath: localSrc.replace("local-file://", "") }
			: event;
		await window.api?.app.previewEvent(eventWithLocalPath);
	};

	return (
		<div className="flex flex-col h-full bg-background">
			<div className="flex-1 overflow-y-auto custom-scrollbar">
				<div className="p-3 px-1 space-y-4">
					<div className="group relative rounded-lg overflow-hidden bg-muted/10 border border-border/40 shadow-sm">
						{imageSrc ? (
							<img
								src={imageSrc}
								alt=""
								className="w-full aspect-video object-cover"
								onError={() => {
									const fb = fallbackRef.current;
									if (fb && imageSrc !== fb) setImageSrc(fb);
									else setImageSrc(null);
								}}
							/>
						) : (
							<div className="w-full aspect-video flex items-center justify-center">
								<div className="text-[10px] text-muted-foreground opacity-50 uppercase tracking-widest font-mono">
									Screenshot
								</div>
							</div>
						)}
						<button
							type="button"
							className="absolute top-2 left-2 h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-black/70 hover:scale-105"
							onClick={expandEventImage}
						>
							<Expand className="h-4 w-4 text-white" />
						</button>

						{event.category && (
							<div className="absolute top-2 right-2">
								<Badge
									className={cn(
										"border-0 max-w-[180px]",
										getCategoryOverlayColor(
											event.category,
											brightness.topRight === "light",
										),
									)}
								>
									<span className="truncate">{event.category}</span>
								</Badge>
							</div>
						)}
					</div>

					<div className="flex items-center justify-between gap-2">
						<div className="max-w-[85%] text-white">
							<div className="text-sm font-semibold leading-snug line-clamp-2 drop-shadow-sm">
								{eventTitle}
							</div>
						</div>
						<div className="text-[10px] text-muted-foreground font-medium">
							{timeAgo(event.timestampMs)}
						</div>
					</div>

					<div className="flex items-center justify-between gap-2">
						{event.appName ? (
							<div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground bg-muted/30 px-2 py-1 rounded-md border border-border/20 min-w-0">
								<AppWindow className="h-3 w-3 opacity-70" />
								<span className="truncate">{event.appName}</span>
							</div>
						) : (
							<div />
						)}
					</div>

					{(event.url || backgroundItem) && (
						<div className="grid grid-cols-1 gap-2">
							{event.url && (
								<button
									type="button"
									className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors text-xs border border-border/20 w-full text-left group"
									onClick={() => window.api?.app.openExternal(event.url!)}
								>
									<div className="h-8 w-8 rounded-md bg-muted/20 flex items-center justify-center shrink-0">
										<Globe className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
									</div>
									<div className="flex flex-col min-w-0 flex-1">
										<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
											Website
										</span>
										<span className="truncate text-foreground/80 font-medium">
											{(() => {
												try {
													return new URL(event.url).hostname;
												} catch {
													return event.url;
												}
											})()}
										</span>
									</div>
									<ExternalLink className="h-3 w-3 text-muted-foreground/50" />
								</button>
							)}

							{backgroundItem && (
								<button
									type="button"
									className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors text-xs border border-border/20 w-full text-left group"
									onClick={() => {
										if (backgroundItem.actionUrl) {
											window.api?.app.openExternal(backgroundItem.actionUrl);
										}
									}}
									disabled={!backgroundItem.actionUrl}
								>
									{backgroundItem.imageUrl ? (
										<img
											src={backgroundItem.imageUrl}
											alt=""
											className="h-8 w-8 rounded-md object-cover shadow-sm"
										/>
									) : (
										<div className="h-8 w-8 rounded-md bg-muted/20 flex items-center justify-center shrink-0">
											<Music className="h-4 w-4 text-muted-foreground" />
										</div>
									)}
									<div className="flex flex-col min-w-0 flex-1">
										<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
											Listening to
										</span>
										<span className="truncate text-foreground/80 font-medium">
											{backgroundItem.title || "Unknown Track"}
										</span>
									</div>
									{backgroundItem.actionUrl && (
										<ExternalLink className="h-3 w-3 text-muted-foreground/50" />
									)}
								</button>
							)}
						</div>
					)}

					<div className="pt-4 border-t border-border/40">
						<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground mb-3 uppercase">
							Comments
						</div>

						{commentError && (
							<div className="text-xs text-destructive bg-destructive/10 p-2 rounded-md mb-3">
								{commentError}
							</div>
						)}

						{parsedComments.length === 0 ? (
							<div className="text-xs text-muted-foreground/60 text-center py-8 bg-muted/5 rounded-lg border border-dashed border-border/40">
								No comments yet
							</div>
						) : (
							<div className="divide-y divide-border/30">
								{parsedComments.map((c) => (
									<div key={c.id} className="py-3 flex gap-2">
										<AvatarDisplay
											userId={c.authorUserId}
											username={c.authorUsername}
											size="xs"
										/>
										<div className="min-w-0 flex-1">
											<div className="flex items-center justify-between gap-2">
												<div className="text-xs font-semibold text-foreground truncate">
													{c.authorUserId === identity?.userId
														? "You"
														: `@${c.authorUsername}`}
												</div>
												<div className="text-[10px] text-muted-foreground whitespace-nowrap">
													{timeAgo(c.timestampMs)}
												</div>
											</div>
											<div className="text-xs text-foreground/90 leading-relaxed mt-1 whitespace-pre-wrap">
												{c.text}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>

			<div className="px-3 pt-2 pb-2 border-t border-border/40 bg-background shrink-0">
				<div className="relative flex items-center">
					<Input
						value={commentText}
						onChange={(e) => onCommentTextChange(e.target.value)}
						placeholder="Write a comment…"
						className="pr-10 h-9 text-sm bg-muted/10 border-border/40 focus-visible:bg-muted/20 focus-visible:ring-1 focus-visible:ring-primary/20 placeholder:text-muted-foreground/50 rounded-lg"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								onSendComment();
							}
						}}
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="absolute right-1 h-7 w-7 rounded-md hover:bg-primary hover:text-primary-foreground transition-colors"
						disabled={!commentText.trim() || isBusy}
						onClick={onSendComment}
					>
						<SendHorizontal className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
