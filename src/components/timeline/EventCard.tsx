import {
	AlertTriangle,
	Check,
	Copy,
	Globe,
	Loader2,
	MonitorPlay,
	Music,
	Trash2,
	TrendingUp,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useImageBrightness } from "@/hooks/useImageBrightness";
import { copyBestImage } from "@/lib/copyImage";
import { isNsfwEvent } from "@/lib/nsfw";
import { cn, formatTime } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { Event } from "@/types";
import { parseBackgroundFromEvent } from "@/types";
import { EventPreview } from "./EventPreview";

const STATUS_ICON = {
	pending: <Loader2 className="h-3 w-3 animate-spin" />,
	processing: <Loader2 className="h-3 w-3 animate-spin" />,
	completed: null,
	failed: <AlertTriangle className="h-3 w-3 text-destructive" />,
} as const;

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

function getContentIcon(contentKind: string | null) {
	if (!contentKind) return null;
	if (
		contentKind.startsWith("youtube") ||
		contentKind.startsWith("netflix") ||
		contentKind.startsWith("twitch")
	) {
		return <MonitorPlay className="h-3 w-3" />;
	}
	if (contentKind === "web_page") {
		return <Globe className="h-3 w-3" />;
	}
	return null;
}

function highResPathFromLowResPath(
	path: string | null | undefined,
): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

function formatContentLabel(event: Event): string | null {
	if (event.contentTitle) return event.contentTitle;
	if (event.windowTitle && event.windowTitle !== event.appName)
		return event.windowTitle;
	if (event.urlHost) return event.urlHost;
	return null;
}

interface EventCardProps {
	event: Event;
	showProject?: boolean;
}

export const EventCard = memo(function EventCard({
	event,
	showProject = false,
}: EventCardProps) {
	const isSelected = useAppStore((s) => s.selectedEventIds.has(event.id));
	const toggleEventSelection = useAppStore((s) => s.toggleEventSelection);
	const removeEvent = useAppStore((s) => s.removeEvent);
	const [showPreview, setShowPreview] = useState(false);

	const isNsfw = useMemo(
		() =>
			isNsfwEvent({
				tags: event.tags,
				urlHost: event.urlHost,
				urlCanonical: event.urlCanonical,
				contentTitle: event.contentTitle,
				windowTitle: event.windowTitle,
			}),
		[
			event.tags,
			event.urlHost,
			event.urlCanonical,
			event.contentTitle,
			event.windowTitle,
		],
	);

	const background = useMemo(() => parseBackgroundFromEvent(event), [event]);
	const screenshotCount = event.screenshotCount ?? 0;
	const endTimestamp = event.endTimestamp ?? event.timestamp;
	const timeLabel =
		endTimestamp > event.timestamp
			? `${formatTime(event.timestamp)}–${formatTime(endTimestamp)}`
			: formatTime(event.timestamp);

	const hqPath = useMemo(
		() =>
			event.projectProgress === 1
				? highResPathFromLowResPath(event.originalPath)
				: null,
		[event.originalPath, event.projectProgress],
	);

	const fallbackLowResPath = useMemo(
		() =>
			event.projectProgress === 1
				? (event.originalPath ?? event.thumbnailPath)
				: event.thumbnailPath,
		[event.originalPath, event.projectProgress, event.thumbnailPath],
	);

	const preferredImagePath = hqPath ?? fallbackLowResPath ?? null;
	const [imagePath, setImagePath] = useState<string | null>(preferredImagePath);
	const brightness = useImageBrightness(imagePath);

	useEffect(() => {
		setImagePath(preferredImagePath);
	}, [preferredImagePath]);

	const deleteEvent = useCallback(async () => {
		await window.api.storage.deleteEvent(event.id);
		removeEvent(event.id);
	}, [event.id, removeEvent]);

	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			if (e.metaKey || e.ctrlKey) {
				toggleEventSelection(event.id);
			} else {
				setShowPreview(true);
			}
		},
		[event.id, toggleEventSelection],
	);

	const handleCopyImage = useCallback(async () => {
		await copyBestImage([hqPath, event.originalPath, event.thumbnailPath]);
	}, [event.originalPath, event.thumbnailPath, hqPath]);

	const contentLabel = useMemo(() => formatContentLabel(event), [event]);
	const appLabel = event.appName ?? null;

	const activity = useMemo(() => {
		if (!contentLabel) return null;
		const icon =
			event.faviconPath && event.urlHost ? (
				<img
					src={`local-file://${event.faviconPath}`}
					alt=""
					className="h-3 w-3 rounded-sm object-contain"
					loading="lazy"
				/>
			) : (
				getContentIcon(event.contentKind)
			);
		return { label: contentLabel, icon };
	}, [contentLabel, event.contentKind, event.faviconPath, event.urlHost]);

	const activityTypeLabel = useMemo(() => {
		if (event.project) return event.project;
		if (!event.category) return null;
		return event.userLabel || event.category;
	}, [event.category, event.userLabel, event.project]);

	return (
		<>
			<div
				className={cn(
					"group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer transition-colors duration-200",
					isSelected && "ring-2 ring-primary border-primary",
					"hover:border-primary/50",
				)}
				onClick={handleClick}
			>
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<div className="aspect-video relative bg-muted">
							{imagePath ? (
								<img
									src={`local-file://${imagePath}`}
									alt=""
									className={cn(
										"w-full h-full object-cover",
										isNsfw && "blur-md",
									)}
									loading="lazy"
									onError={() => {
										if (hqPath && imagePath === hqPath) {
											const next = fallbackLowResPath ?? null;
											if (next && next !== imagePath) setImagePath(next);
										} else if (
											fallbackLowResPath &&
											imagePath === fallbackLowResPath &&
											event.thumbnailPath
										) {
											if (event.thumbnailPath !== imagePath)
												setImagePath(event.thumbnailPath);
										}
									}}
								/>
							) : (
								<div className="w-full h-full flex items-center justify-center text-muted-foreground">
									No thumbnail
								</div>
							)}

							<div className="absolute top-2 left-2 flex gap-1">
								{isSelected && (
									<Badge className="bg-primary/90 text-primary-foreground border-0 px-1.5">
										<Check className="h-3 w-3" />
									</Badge>
								)}
								{screenshotCount > 1 && (
									<Badge
										variant="outline"
										className={cn(
											"backdrop-blur-sm size-5 flex items-center justify-center text-xs rounded-md",
											brightness.topLeft === "light"
												? "bg-white/70 text-black/60 font-medium border-gray-600/30"
												: "bg-background/70",
										)}
									>
										{screenshotCount}
									</Badge>
								)}
							</div>

							{activityTypeLabel && (
								<div className="absolute bottom-2 right-2 pointer-events-none">
									<Badge
										className={cn(
											"border-0 flex items-center gap-1 max-w-[180px]",
											getCategoryOverlayColor(
												event.userLabel || event.category,
												brightness.bottomRight === "light",
											),
										)}
									>
										{event.projectProgress === 1 && (
											<TrendingUp className="h-3 w-3 flex-shrink-0" />
										)}
										<span className="truncate">{activityTypeLabel}</span>
									</Badge>
								</div>
							)}

							{(event.trackedAddiction ||
								(!event.trackedAddiction && event.addictionCandidate)) && (
								<div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
									{event.trackedAddiction && (
										<Badge
											className={cn(
												"border-0 backdrop-blur-sm",
												brightness.topRight === "light"
													? "bg-red-800/70 text-white font-medium"
													: "bg-destructive/90 text-destructive-foreground",
											)}
										>
											{event.trackedAddiction}
										</Badge>
									)}
									{!event.trackedAddiction && event.addictionCandidate && (
										<Badge
											className={cn(
												"border-0 backdrop-blur-sm",
												brightness.topRight === "light"
													? "bg-amber-800/70 text-white font-medium"
													: "bg-amber-500/90 text-white",
											)}
										>
											Review: {event.addictionCandidate}
										</Badge>
									)}
								</div>
							)}
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem onSelect={() => setShowPreview(true)}>
							View
						</ContextMenuItem>
						<ContextMenuItem onSelect={handleCopyImage}>
							<Copy className="mr-1.5 size-3" />
							Copy image
						</ContextMenuItem>
						<ContextMenuItem onSelect={deleteEvent}>
							<Trash2 className="mr-1.5 size-3" />
							Delete
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>

				<div className="p-3 grid gap-1.5">
					<div className="flex items-start justify-between gap-2 min-w-0">
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium leading-snug line-clamp-2">
								{event.caption || "Processing..."}
							</p>
						</div>
						{STATUS_ICON[event.status]}
					</div>

					<div className="flex items-center gap-0.5 min-w-0 text-xs text-muted-foreground">
						<span className="whitespace-nowrap">{timeLabel}</span>
						{appLabel && (
							<>
								<span className="text-muted-foreground/60">:</span>
								{event.appIconPath && (
									<img
										src={`local-file://${event.appIconPath}`}
										alt=""
										className="size-4 rounded-sm object-contain"
										loading="lazy"
									/>
								)}
								<span className="truncate">{appLabel}</span>
							</>
						)}
					</div>

					{activity && (
						<div className="flex items-center gap-1 min-w-0 text-xs text-muted-foreground">
							{activity.icon}
							<span className="truncate">{activity.label}</span>
						</div>
					)}

					<div className="flex items-center gap-2 flex-wrap">
						{showProject && event.project && (
							<Badge
								variant="outline"
								className="text-xs max-w-[160px] truncate"
							>
								{event.project}
							</Badge>
						)}
					</div>

					{background[0] && (
						<div
							className={cn(
								"flex items-center gap-1.5 min-w-0 overflow-hidden flex-nowrap text-xs text-muted-foreground",
								background[0].actionUrl && "cursor-pointer hover:opacity-80",
							)}
							onClick={(e) => {
								const bg = background[0];
								if (!bg?.actionUrl) return;
								e.stopPropagation();
								void window.api.app.openExternal(bg.actionUrl);
							}}
							title={
								background[0].actionUrl
									? `Open in ${background[0].provider}`
									: undefined
							}
						>
							{background[0].imageUrl ? (
								<img
									src={background[0].imageUrl}
									alt=""
									className="h-4 w-4 rounded-sm object-cover flex-shrink-0"
									loading="lazy"
								/>
							) : (
								<Music className="h-3 w-3 flex-shrink-0" />
							)}
							<span className="truncate min-w-0">
								{background[0].title}
								{background[0].subtitle ? ` · ${background[0].subtitle}` : ""}
							</span>
							{background.length > 1 && (
								<span className="flex-shrink-0 text-muted-foreground/60 whitespace-nowrap">
									+{background.length - 1}
								</span>
							)}
						</div>
					)}
				</div>
			</div>

			<EventPreview
				event={event}
				open={showPreview}
				onOpenChange={setShowPreview}
			/>
		</>
	);
});
