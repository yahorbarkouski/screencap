import {
	Activity,
	AppWindow,
	BookOpen,
	Briefcase,
	ChevronLeft,
	ChevronRight,
	Clock,
	Copy,
	ExternalLink,
	Eye,
	EyeOff,
	FolderKanban,
	Gamepad2,
	HelpCircle,
	Home,
	ImageIcon,
	Music,
	Rocket,
	Settings2,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthorAvatar } from "@/components/progress/AuthorAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	behaviorFromAutomationRule,
	isEmptyAutomationRule,
	normalizeAutomationRule,
	type RuleBehavior,
	updatesForBehavior,
} from "@/lib/automationRules";
import { copyBestImage } from "@/lib/copyImage";
import { isNsfwEvent } from "@/lib/nsfw";
import { cn, getCategoryColor } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type {
	AutomationRule,
	Event,
	EventScreenshot,
	Settings,
	SocialIdentity,
} from "@/types";
import { parseBackgroundFromEvent } from "@/types";

const CATEGORIES = ["Study", "Work", "Leisure", "Chores", "Social", "Unknown"];

const CATEGORY_ICON = {
	Study: BookOpen,
	Work: Briefcase,
	Leisure: Gamepad2,
	Chores: Home,
	Social: Users,
	Unknown: HelpCircle,
} as const;

function formatContentKind(kind: string | null): string {
	if (!kind) return "";
	const map: Record<string, string> = {
		youtube_video: "YouTube Video",
		youtube_short: "YouTube Short",
		netflix_title: "Netflix",
		twitch_stream: "Twitch Stream",
		twitch_vod: "Twitch VOD",
		spotify_track: "Spotify Track",
		spotify_episode: "Spotify Episode",
		web_page: "Web Page",
	};
	return map[kind] || kind;
}

function highResPathFromLowResPath(
	path: string | null | undefined,
): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

function parseStringArrayJson(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

function formatHeaderDate(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const opts: Intl.DateTimeFormatOptions = {
		weekday: "short",
		month: "short",
		day: "numeric",
	};
	if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
	return date.toLocaleDateString("en-US", opts);
}

function formatHeaderTimeRange(start: number, end: number): string {
	const fmt: Intl.DateTimeFormatOptions = {
		hour: "numeric",
		minute: "2-digit",
	};
	const startStr = new Date(start).toLocaleTimeString("en-US", fmt);
	if (!Number.isFinite(end) || end <= start) return startStr;
	const endStr = new Date(end).toLocaleTimeString("en-US", fmt);
	return `${startStr} – ${endStr}`;
}

interface EventPreviewProps {
	event: Event;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function getActiveScreenshotIndex(
	screenshots: EventScreenshot[],
	activeId: string | null,
): number {
	if (screenshots.length === 0) return -1;
	if (activeId) {
		const idx = screenshots.findIndex((s) => s.id === activeId);
		if (idx !== -1) return idx;
	}
	const primaryIdx = screenshots.findIndex((s) => s.isPrimary);
	return primaryIdx !== -1 ? primaryIdx : 0;
}

export function EventPreview({ event, open, onOpenChange }: EventPreviewProps) {
	const [nsfwRevealed, setNsfwRevealed] = useState(false);
	const [screenshots, setScreenshots] = useState<EventScreenshot[]>([]);
	const [activeScreenshotId, setActiveScreenshotId] = useState<string | null>(
		null,
	);
	const [automationRules, setAutomationRules] = useState<
		Settings["automationRules"] | null
	>(null);
	const [projects, setProjects] = useState<string[]>([]);
	const [identity, setIdentity] = useState<SocialIdentity | null>(null);
	const removeEvent = useAppStore((s) => s.removeEvent);
	const updateEvent = useAppStore((s) => s.updateEvent);

	const tags = parseStringArrayJson(event.tags);
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
	const endTimestamp = event.endTimestamp ?? event.timestamp;
	const headerTimeLabel = useMemo(
		() => formatHeaderTimeRange(event.timestamp, endTimestamp),
		[event.timestamp, endTimestamp],
	);
	const headerDateLabel = useMemo(
		() => formatHeaderDate(event.timestamp),
		[event.timestamp],
	);
	const canOpenContextUrl = Boolean(event.urlCanonical);
	const contextTitle = event.urlHost
		? event.contentTitle || event.urlHost
		: event.appName || event.appBundleId || "Unknown Application";
	const contextMeta = useMemo(() => {
		const parts: string[] = [];
		if (event.urlHost && event.contentTitle) parts.push(event.urlHost);
		const appLabel = event.appName || event.appBundleId;
		if (appLabel) parts.push(appLabel);
		if (!event.urlHost && event.windowTitle) parts.push(event.windowTitle);
		return parts.join(" · ");
	}, [
		event.appBundleId,
		event.appName,
		event.contentTitle,
		event.urlHost,
		event.windowTitle,
	]);
	const eventName =
		event.caption?.trim() ||
		event.contentTitle?.trim() ||
		event.windowTitle?.trim() ||
		event.urlHost?.trim() ||
		event.appName?.trim() ||
		"Screenshot";
	const activeIndex = getActiveScreenshotIndex(screenshots, activeScreenshotId);
	const activeScreenshot = activeIndex >= 0 ? screenshots[activeIndex] : null;
	const previewBasePath = activeScreenshot?.originalPath ?? event.originalPath;
	const previewHighResPath = highResPathFromLowResPath(previewBasePath);
	const [previewPath, setPreviewPath] = useState<string | null>(
		previewHighResPath ?? previewBasePath ?? null,
	);
	const previewIndexLabel =
		screenshots.length > 0 && activeIndex >= 0
			? `${activeIndex + 1} / ${screenshots.length}`
			: null;
	const progressConfidence =
		event.projectProgressConfidence != null
			? Math.round(event.projectProgressConfidence * 100)
			: null;

	const isSharedFromOther =
		event.isRemote &&
		event.authorUserId &&
		event.authorUsername &&
		identity &&
		event.authorUserId !== identity.userId;

	useEffect(() => {
		setPreviewPath(previewHighResPath ?? previewBasePath ?? null);
	}, [previewBasePath, previewHighResPath]);

	const handleCopyPreview = async () => {
		await copyBestImage([
			previewHighResPath,
			previewBasePath,
			event.thumbnailPath,
		]);
	};

	const navigate = useCallback(
		(delta: number) => {
			if (screenshots.length < 2) return;
			const idx = getActiveScreenshotIndex(screenshots, activeScreenshotId);
			if (idx < 0) return;
			const next = (idx + delta + screenshots.length) % screenshots.length;
			setActiveScreenshotId(screenshots[next]?.id ?? null);
		},
		[activeScreenshotId, screenshots],
	);

	useEffect(() => {
		if (!open) return;

		let cancelled = false;

		const run = async () => {
			try {
				const items = await window.api.storage.getEventScreenshots(event.id);
				if (cancelled) return;
				setScreenshots(items);
				const primary = items.find((s) => s.isPrimary) ?? items[0] ?? null;
				setActiveScreenshotId(primary?.id ?? null);
			} catch {
				if (cancelled) return;
				setScreenshots([]);
				setActiveScreenshotId(null);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, [event.id, open]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const load = async () => {
			const [settings, projectList] = await Promise.all([
				window.api.settings.get(),
				window.api.storage.getProjects(),
			]);
			if (!cancelled) {
				setAutomationRules(settings.automationRules);
				setProjects(projectList);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [open]);

	useEffect(() => {
		if (!window.api?.social) return;
		void window.api.social.getIdentity().then(setIdentity);
	}, []);

	useEffect(() => {
		if (!open || screenshots.length < 2) return;

		const handler = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const tag = el?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable)
				return;

			if (e.key === "ArrowLeft") {
				e.preventDefault();
				navigate(-1);
			}
			if (e.key === "ArrowRight") {
				e.preventDefault();
				navigate(1);
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, screenshots, navigate]);

	const handleRelabel = useCallback(
		async (label: string) => {
			await window.api.storage.relabelEvents([event.id], label);
			updateEvent(event.id, { userLabel: label, confidence: 1 });
		},
		[event.id, updateEvent],
	);

	const handleSetProject = useCallback(
		async (project: string | null) => {
			await window.api.storage.setEventProject(event.id, project);
			updateEvent(event.id, { project });
		},
		[event.id, updateEvent],
	);

	const handleConfirmAddiction = async () => {
		await window.api.storage.confirmAddiction([event.id]);
		onOpenChange(false);
	};

	const handleRejectAddiction = async () => {
		await window.api.storage.rejectAddiction([event.id]);
		onOpenChange(false);
	};

	const handleDelete = async () => {
		await window.api.storage.deleteEvent(event.id);
		removeEvent(event.id);
		onOpenChange(false);
	};

	const [isSharing, setIsSharing] = useState(false);
	const [shareError, setShareError] = useState(false);
	const [isGeneratingSocialImage, setIsGeneratingSocialImage] = useState(false);
	const [socialImageError, setSocialImageError] = useState(false);

	const canShareToFriends = Boolean(identity && !event.isRemote);
	const isSharedToFriends = event.sharedToFriends === 1;

	const handleShareToFriends = useCallback(async () => {
		if (!canShareToFriends || isSharedToFriends) return;
		setIsSharing(true);
		setShareError(false);
		try {
			await window.api.socialFeed.publishEventToAllFriends(event.id);
			updateEvent(event.id, { sharedToFriends: 1 });
		} catch {
			setShareError(true);
			setTimeout(() => setShareError(false), 2000);
		} finally {
			setIsSharing(false);
		}
	}, [canShareToFriends, isSharedToFriends, event.id, updateEvent]);

	const handleGenerateSocialImage = useCallback(async () => {
		if (isGeneratingSocialImage) return;
		setIsGeneratingSocialImage(true);
		setSocialImageError(false);
		try {
			const background = parseBackgroundFromEvent(event);
			const imagePaths = [
				previewHighResPath,
				previewBasePath,
				event.originalPath,
				event.thumbnailPath,
			].filter((p): p is string => Boolean(p));

			if (imagePaths.length === 0) {
				throw new Error("No image available");
			}

			const title =
				event.caption?.trim() ||
				event.contentTitle?.trim() ||
				event.windowTitle?.trim() ||
				"Screenshot";

			const bg = background[0];
			const generatedPath = await window.api.social.generateSocialImage({
				imagePaths,
				title,
				timestamp: event.timestamp,
				category: event.userLabel || event.category,
				appName: event.appName,
				appIconPath: event.appIconPath,
				backgroundTitle: bg?.title ?? null,
				backgroundArtist: bg?.subtitle ?? null,
				backgroundImageUrl: bg?.imageUrl ?? null,
			});

			await window.api.app.copyImage(generatedPath);
		} catch (error) {
			console.error("Failed to generate social image:", error);
			setSocialImageError(true);
			setTimeout(() => setSocialImageError(false), 2000);
		} finally {
			setIsGeneratingSocialImage(false);
		}
	}, [isGeneratingSocialImage, event, previewHighResPath, previewBasePath]);

	const handleMarkProgress = async () => {
		await window.api.storage.markProjectProgress(event.id);
		updateEvent(event.id, {
			projectProgress: 1,
			projectProgressEvidence: "manual",
		});
	};

	const handleUnmarkProgress = async () => {
		await window.api.storage.unmarkProjectProgress(event.id);
		updateEvent(event.id, {
			projectProgress: 0,
			projectProgressEvidence: null,
			projectProgressConfidence: null,
		});
	};

	const updateAutomationRule = useCallback(
		async (
			ruleType: "apps" | "hosts",
			key: string,
			updates: Partial<AutomationRule>,
		) => {
			const settings = await window.api.settings.get();
			const existingRule = settings.automationRules[ruleType][key] ?? {};
			const mergedRule = normalizeAutomationRule({
				...existingRule,
				...updates,
			});
			const nextTypeRules = { ...settings.automationRules[ruleType] };
			if (isEmptyAutomationRule(mergedRule)) {
				delete nextTypeRules[key];
			} else {
				nextTypeRules[key] = mergedRule;
			}
			const newRules = {
				...settings.automationRules,
				[ruleType]: nextTypeRules,
			};
			const newSettings: Settings = {
				...settings,
				automationRules: newRules,
			};
			await window.api.settings.set(newSettings);
			setAutomationRules(newRules);
		},
		[],
	);

	const appRule = event.appBundleId
		? automationRules?.apps[event.appBundleId]
		: undefined;
	const hostRule = event.urlHost
		? automationRules?.hosts[event.urlHost]
		: undefined;

	const appBehavior = behaviorFromAutomationRule(appRule ?? {});
	const hostBehavior = behaviorFromAutomationRule(hostRule ?? {});

	const setBehavior = useCallback(
		async (ruleType: "apps" | "hosts", key: string, behavior: RuleBehavior) => {
			await updateAutomationRule(ruleType, key, updatesForBehavior(behavior));
		},
		[updateAutomationRule],
	);

	const hasAutomationOptions = Boolean(event.appBundleId || event.urlHost);

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) setNsfwRevealed(false);
				onOpenChange(isOpen);
			}}
		>
			<DialogContent className="max-w-3xl h-[min(92vh,980px)] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl flex flex-col gap-0 outline-none">
				<div className="flex items-start justify-between pl-6 pr-10 py-2 border-b border-border/20 shrink-0 bg-background/40">
					<div className="min-w-0 py-2">
						<div className="flex flex-wrap items-center gap-2 min-w-0">
							<DialogTitle className="min-w-0 flex-1 text-lg font-semibold leading-tight line-clamp-2">
								{eventName}
							</DialogTitle>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className={cn(
											"shrink-0 h-6 px-2 rounded-full text-xs font-medium transition hover:opacity-90",
											getCategoryColor(event.userLabel || event.category),
										)}
									>
										{event.userLabel || event.category || "Label"}
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="w-44">
									<DropdownMenuRadioGroup
										value={event.userLabel || event.category || ""}
										onValueChange={(value) => void handleRelabel(value)}
									>
										{CATEGORIES.map((cat) => {
											const Icon =
												CATEGORY_ICON[cat as keyof typeof CATEGORY_ICON];
											return (
												<DropdownMenuRadioItem key={cat} value={cat}>
													<Icon className="h-4 w-4 mr-2 opacity-70" />
													{cat}
												</DropdownMenuRadioItem>
											);
										})}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
							{event.projectProgress === 1 && (
								<Badge
									variant="secondary"
									className="shrink-0 h-6 px-2 rounded-full border-transparent bg-primary/10 text-primary gap-1.5"
								>
									<Rocket className="h-3.5 w-3.5" />
									{progressConfidence != null
										? `Progress ${progressConfidence}%`
										: "Progress"}
								</Badge>
							)}
						</div>
						<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
							<Clock className="h-3 w-3" />
							<span className="truncate">
								{headerDateLabel} · {headerTimeLabel}
							</span>
						</div>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className={cn(
							"px-2 py-1",
							isSharedToFriends
								? "bg-muted text-accent-foreground hover:bg-muted"
								: "",
						)}
						onClick={() => void handleShareToFriends()}
						disabled={!canShareToFriends || isSharing || isSharedToFriends}
					>
						{isSharing ? (
							<div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
						) : (
							<Users className="h-4 w-4" />
						)}
						{isSharedToFriends
							? "Shared"
							: shareError
								? "Failed"
								: isSharing
									? "Sharing..."
									: "Share"}
					</Button>
				</div>

				<ScrollArea className="flex-1">
					<div className="flex flex-col">
						<div className="relative w-full bg-muted/20 group">
							<ContextMenu>
								<ContextMenuTrigger asChild>
									<div className="relative w-full h-[55vh] flex items-center justify-center">
										{previewPath ? (
											<div className="relative w-full h-full">
												<img
													src={`local-file://${previewPath}`}
													alt=""
													className={cn(
														"w-full h-full object-contain transition-all duration-500",
														isNsfw && !nsfwRevealed && "blur-2xl scale-105",
													)}
													onError={() => {
														if (
															previewHighResPath &&
															previewPath === previewHighResPath &&
															previewBasePath
														) {
															setPreviewPath(previewBasePath);
														}
													}}
												/>
											</div>
										) : (
											<div className="flex flex-col items-center justify-center text-muted-foreground/50 gap-3">
												<div className="p-4 rounded-full bg-muted/50">
													<EyeOff className="w-8 h-8" />
												</div>
												<span className="text-sm font-medium">
													No preview available
												</span>
											</div>
										)}
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onSelect={handleCopyPreview}>
										<Copy className="mr-2 h-4 w-4" />
										Copy image
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>

							{screenshots.length > 1 && (
								<>
									<div className="absolute inset-y-0 left-0 flex items-center px-2 opacity-0 group-hover:opacity-100 transition-opacity">
										<Button
											variant="secondary"
											size="icon"
											className="h-10 w-10 rounded-full bg-background/80 backdrop-blur border border-border/50 shadow-lg hover:bg-background hover:scale-110 transition-all"
											onClick={() => navigate(-1)}
										>
											<ChevronLeft className="h-5 w-5" />
										</Button>
									</div>
									<div className="absolute inset-y-0 right-0 flex items-center px-2 opacity-0 group-hover:opacity-100 transition-opacity">
										<Button
											variant="secondary"
											size="icon"
											className="h-10 w-10 rounded-full bg-background/80 backdrop-blur border border-border/50 shadow-lg hover:bg-background hover:scale-110 transition-all"
											onClick={() => navigate(1)}
										>
											<ChevronRight className="h-5 w-5" />
										</Button>
									</div>
									{previewIndexLabel && screenshots.length > 2 && (
										<div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
											<Badge
												variant="secondary"
												className="bg-background/80 backdrop-blur border border-border/50 shadow-lg px-3 py-1 text-xs"
											>
												{previewIndexLabel}
											</Badge>
										</div>
									)}
								</>
							)}

							{screenshots.length === 2 && activeIndex >= 0 && (
								<div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-background/70 backdrop-blur border border-border/50 px-2 py-1">
									{screenshots.map((s, idx) => (
										<button
											key={s.id}
											type="button"
											aria-label={`Screenshot ${idx + 1}`}
											aria-current={idx === activeIndex ? "true" : undefined}
											onClick={() => setActiveScreenshotId(s.id)}
											className={cn(
												"h-1.5 w-6 rounded-full transition",
												idx === activeIndex
													? "bg-foreground/70"
													: "bg-foreground/20 hover:bg-foreground/35",
											)}
										/>
									))}
								</div>
							)}

							{isNsfw && (
								<div className="absolute top-4 left-4 z-10">
									<Button
										variant="secondary"
										size="sm"
										className={cn(
											"gap-2 bg-background/80 backdrop-blur border border-border/50 shadow-sm transition-all",
											nsfwRevealed
												? "opacity-50 hover:opacity-100"
												: "text-destructive hover:bg-destructive/10",
										)}
										onClick={() => setNsfwRevealed(!nsfwRevealed)}
									>
										{nsfwRevealed ? (
											<>
												<EyeOff className="h-4 w-4" />
												Hide
											</>
										) : (
											<>
												<Eye className="h-4 w-4" />
												Reveal NSFW
											</>
										)}
									</Button>
								</div>
							)}
						</div>

						{screenshots.length > 2 && (
							<div className="px-6 py-3 border-b border-border/15 bg-muted/10">
								<div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
									{screenshots.map((s) => {
										const hq = highResPathFromLowResPath(s.originalPath);
										const handleCopy = async () => {
											await copyBestImage([
												hq,
												s.originalPath,
												s.thumbnailPath,
											]);
										};

										return (
											<ContextMenu key={s.id}>
												<ContextMenuTrigger asChild>
													<button
														type="button"
														onClick={() => setActiveScreenshotId(s.id)}
														className={cn(
															"relative shrink-0 h-12 w-16 rounded-md overflow-hidden bg-muted/20 transition",
															s.id === activeScreenshot?.id
																? "ring-2 ring-primary border-primary"
																: "opacity-70 hover:opacity-100 hover:border-primary/60",
														)}
													>
														<img
															src={`local-file://${s.thumbnailPath}`}
															alt=""
															className={cn(
																"h-12 w-16 object-cover",
																isNsfw && !nsfwRevealed && "blur-sm",
															)}
															loading="lazy"
														/>
														{s.isPrimary && (
															<div className="absolute top-1 left-1">
																<Badge
																	variant="secondary"
																	className="text-[10px] px-1 py-0 bg-background/80 backdrop-blur"
																>
																	Primary
																</Badge>
															</div>
														)}
													</button>
												</ContextMenuTrigger>
												<ContextMenuContent>
													<ContextMenuItem onSelect={handleCopy}>
														<Copy className="mr-2 h-4 w-4" />
														Copy image
													</ContextMenuItem>
												</ContextMenuContent>
											</ContextMenu>
										);
									})}
								</div>
							</div>
						)}

						<div className="p-6 max-w-3xl mx-auto w-full">
							<div className="space-y-4">
								{isSharedFromOther && (
									<div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/10">
										<AuthorAvatar
											userId={event.authorUserId}
											username={event.authorUsername!}
										/>
										<div className="min-w-0">
											<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase">
												Shared by
											</div>
											<div className="mt-0.5 text-sm font-semibold truncate">
												@{event.authorUsername}
											</div>
										</div>
									</div>
								)}

								<div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
									<div
										className={cn(
											"px-4 py-3",
											canOpenContextUrl &&
												"cursor-pointer hover:bg-muted/30 transition-colors",
										)}
										onClick={
											canOpenContextUrl
												? () =>
														void window.api.app.openExternal(
															event.urlCanonical!,
														)
												: undefined
										}
										onKeyDown={
											canOpenContextUrl
												? (e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															void window.api.app.openExternal(
																event.urlCanonical!,
															);
														}
													}
												: undefined
										}
										role={canOpenContextUrl ? "button" : undefined}
										tabIndex={canOpenContextUrl ? 0 : undefined}
									>
										<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase mb-2">
											{event.urlHost ? "App & Website" : "App"}
										</div>
										<div className="flex items-center gap-3">
											<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 shrink-0 overflow-hidden">
												{event.faviconPath && event.urlHost ? (
													<img
														src={`local-file://${event.faviconPath}`}
														alt=""
														className="h-full w-full object-contain p-1.5"
													/>
												) : event.appIconPath ? (
													<img
														src={`local-file://${event.appIconPath}`}
														alt=""
														className="h-full w-full object-contain"
													/>
												) : (
													<AppWindow className="h-5 w-5 text-muted-foreground/50" />
												)}
											</div>
											<div className="min-w-0 flex-1">
												<h3 className="text-sm font-medium truncate leading-tight">
													{contextTitle}
												</h3>
												{contextMeta && (
													<div className="text-xs text-muted-foreground truncate">
														{contextMeta}
													</div>
												)}
											</div>
											{canOpenContextUrl && (
												<ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
											)}
										</div>
									</div>

									{background.length > 0 && (
										<div className="px-4 py-3">
											<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase mb-2">
												Background
											</div>
											{background.map((bg, idx) => {
												const title =
													bg.title ??
													formatContentKind(bg.kind) ??
													"Background";
												const kindLabel = formatContentKind(bg.kind);
												const meta =
													bg.subtitle && kindLabel
														? `${bg.subtitle} · ${kindLabel}`
														: (bg.subtitle ?? kindLabel);

												return (
													<div
														key={`${bg.provider}:${bg.id}`}
														className={cn(
															"flex items-center gap-3 py-2",
															idx !== background.length - 1 &&
																"border-b border-border/10",
															bg.actionUrl &&
																"cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors",
														)}
														onClick={
															bg.actionUrl
																? () =>
																		void window.api.app.openExternal(
																			bg.actionUrl!,
																		)
																: undefined
														}
														onKeyDown={
															bg.actionUrl
																? (e) => {
																		if (e.key === "Enter" || e.key === " ") {
																			e.preventDefault();
																			void window.api.app.openExternal(
																				bg.actionUrl!,
																			);
																		}
																	}
																: undefined
														}
														role={bg.actionUrl ? "button" : undefined}
														tabIndex={bg.actionUrl ? 0 : undefined}
													>
														{bg.imageUrl ? (
															<img
																src={bg.imageUrl}
																alt=""
																className="h-10 w-10 rounded-lg object-cover"
																loading="lazy"
															/>
														) : (
															<div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
																<Music className="h-5 w-5 text-muted-foreground" />
															</div>
														)}
														<div className="min-w-0 flex-1">
															<div className="text-sm font-medium truncate">
																{title}
															</div>
															{meta && (
																<div className="text-xs text-muted-foreground truncate">
																	{meta}
																</div>
															)}
														</div>
														{bg.actionUrl && (
															<ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
														)}
													</div>
												);
											})}
										</div>
									)}

									<div className="px-4 py-3">
										<div className="flex items-center justify-between gap-3 mb-2">
											<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase">
												Project
											</div>
											<Button
												variant="ghost"
												size="sm"
												className={cn(
													"h-6 px-2 text-xs",
													event.projectProgress === 1
														? "text-primary"
														: "text-muted-foreground hover:text-foreground",
												)}
												onClick={
													event.projectProgress === 1
														? handleUnmarkProgress
														: handleMarkProgress
												}
											>
												<Rocket className="h-3 w-3" />
												{event.projectProgress === 1
													? "Unmark as progress"
													: "Mark as progress"}
											</Button>
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													type="button"
													className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors text-left"
												>
													<FolderKanban className="h-4 w-4 text-muted-foreground shrink-0" />
													<span className="text-sm font-medium truncate max-w-[200px]">
														{event.project || "No project"}
													</span>
													<ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="start" className="w-[200px]">
												<DropdownMenuLabel>Select Project</DropdownMenuLabel>
												<DropdownMenuSeparator />
												<DropdownMenuRadioGroup
													value={event.project || ""}
													onValueChange={(value) =>
														void handleSetProject(value || null)
													}
												>
													<DropdownMenuRadioItem value="">
														<X className="h-4 w-4 mr-2 text-muted-foreground" />
														No project
													</DropdownMenuRadioItem>
													{projects.map((proj) => (
														<DropdownMenuRadioItem key={proj} value={proj}>
															{proj}
														</DropdownMenuRadioItem>
													))}
												</DropdownMenuRadioGroup>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>

									{tags.length > 0 && (
										<div className="px-4 py-3">
											<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase mb-2">
												Tags
											</div>
											<div className="flex flex-wrap gap-1.5">
												{tags.map((tag: string) => (
													<Badge
														key={tag}
														variant="secondary"
														className="text-xs px-2 py-0.5 bg-muted/50 text-muted-foreground font-normal"
													>
														#{tag}
													</Badge>
												))}
											</div>
										</div>
									)}

									{(event.trackedAddiction || event.addictionCandidate) && (
										<div
											className={cn(
												"px-4 py-3",
												event.trackedAddiction
													? "bg-destructive/5"
													: "bg-amber-500/5",
											)}
										>
											<div className="flex items-start justify-between gap-4">
												<div className="min-w-0">
													<div className="flex items-center gap-2">
														<Activity
															className={cn(
																"h-4 w-4 shrink-0",
																event.trackedAddiction
																	? "text-destructive"
																	: "text-amber-500",
															)}
														/>
														<div
															className={cn(
																"text-sm font-semibold truncate",
																event.trackedAddiction
																	? "text-destructive"
																	: "text-amber-500",
															)}
														>
															{event.trackedAddiction
																? `Addiction detected: ${event.trackedAddiction}`
																: `Potential addiction: ${event.addictionCandidate}`}
														</div>
													</div>
													{!event.trackedAddiction && event.addictionPrompt && (
														<p className="mt-2 text-xs text-muted-foreground leading-relaxed">
															{event.addictionPrompt}
														</p>
													)}
												</div>
												{event.addictionConfidence != null && (
													<div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
														{Math.round(event.addictionConfidence * 100)}%
													</div>
												)}
											</div>
											{!event.trackedAddiction && (
												<div className="mt-3 flex justify-end gap-2">
													<Button
														size="sm"
														variant="ghost"
														className="h-8 text-xs bg-background/10 hover:bg-background/20"
														onClick={handleRejectAddiction}
													>
														Reject
													</Button>
													<Button
														size="sm"
														className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0"
														onClick={handleConfirmAddiction}
													>
														Confirm
													</Button>
												</div>
											)}
											{event.trackedAddiction && (
												<div className="mt-3 flex justify-end">
													<Button
														size="sm"
														variant="ghost"
														className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
														onClick={handleRejectAddiction}
													>
														Not an addiction
													</Button>
												</div>
											)}
										</div>
									)}

									<div className="px-4 py-3">
										<div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase mb-2">
											Actions
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{hasAutomationOptions && (
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="outline"
															size="sm"
															className="h-8 gap-2 text-xs"
														>
															<Settings2 className="h-3.5 w-3.5" />
															Rules
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="start" className="w-56">
														{event.appBundleId && (
															<>
																<DropdownMenuLabel className="truncate">
																	{event.appName || event.appBundleId}
																</DropdownMenuLabel>
																<DropdownMenuRadioGroup
																	value={appBehavior}
																	onValueChange={(value) =>
																		void setBehavior(
																			"apps",
																			event.appBundleId!,
																			value as RuleBehavior,
																		)
																	}
																>
																	<DropdownMenuRadioItem value="default">
																		Default
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="no_capture">
																		Don&apos;t capture
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="capture_only">
																		Capture only (no AI)
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="capture_ai">
																		Capture + AI
																	</DropdownMenuRadioItem>
																</DropdownMenuRadioGroup>
															</>
														)}
														{event.appBundleId && event.urlHost && (
															<DropdownMenuSeparator />
														)}
														{event.urlHost && (
															<>
																<DropdownMenuLabel className="truncate">
																	{event.urlHost}
																</DropdownMenuLabel>
																<DropdownMenuRadioGroup
																	value={hostBehavior}
																	onValueChange={(value) =>
																		void setBehavior(
																			"hosts",
																			event.urlHost!,
																			value as RuleBehavior,
																		)
																	}
																>
																	<DropdownMenuRadioItem value="default">
																		Default
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="no_capture">
																		Don&apos;t capture
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="capture_only">
																		Capture only (no AI)
																	</DropdownMenuRadioItem>
																	<DropdownMenuRadioItem value="capture_ai">
																		Capture + AI
																	</DropdownMenuRadioItem>
																</DropdownMenuRadioGroup>
															</>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											)}
											<Button
												variant="outline"
												size="sm"
												className="h-8 gap-2 text-xs"
												onClick={handleGenerateSocialImage}
												disabled={isGeneratingSocialImage}
											>
												{isGeneratingSocialImage ? (
													<div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
												) : (
													<ImageIcon className="h-3.5 w-3.5" />
												)}
												{socialImageError
													? "Failed"
													: isGeneratingSocialImage
														? "Generating..."
														: "Share Image"}
											</Button>
											<Button
												variant="outline"
												size="sm"
												className="h-8 gap-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
												onClick={handleDelete}
											>
												<Trash2 className="h-3.5 w-3.5" />
												Delete
											</Button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
