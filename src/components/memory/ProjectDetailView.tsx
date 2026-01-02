import { endOfDay, startOfDay, subDays } from "date-fns";
import {
	ArrowLeft,
	Calendar,
	Camera,
	Check,
	Clock,
	GitCommit,
	Loader2,
	Pencil,
	RefreshCcw,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ProgressTimelineGroup,
	type ProgressTimelineItem,
} from "@/components/progress/ProgressTimelineGroup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangeSelect } from "@/components/ui/date-range-select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShortcutKbd } from "@/components/ui/shortcut-kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectStats } from "@/hooks/useProjectStats";
import { formatRelativeTime, formatTime, groupEventsByDate } from "@/lib/utils";
import type {
	Event,
	GitCommit as GitCommitType,
	Memory,
	RepoWorkSession,
} from "@/types";
import { ProjectRepoManager } from "./ProjectRepoManager";

interface ProjectDetailViewProps {
	project: Memory;
	stats?: ProjectStats;
	onBack: () => void;
	onEdit: (
		id: string,
		updates: { content: string; description?: string | null },
	) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}

function highResPathFromLowResPath(
	path: string | null | undefined,
): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

function repoLabel(repoRoot: string): string {
	const parts = repoRoot.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? repoRoot;
}

function sessionDurationLabel(session: RepoWorkSession): string {
	const endAt = session.isOpen ? Date.now() : session.endAt;
	const minutes = Math.max(0, Math.round((endAt - session.startAt) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rem = minutes % 60;
	return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

type CaptureState =
	| { kind: "idle" }
	| { kind: "capturing" }
	| {
			kind: "ready" | "saving";
			eventId: string;
			caption: string;
			previewPath: string | null;
			fallbackPath: string | null;
			highResPath: string | null;
	  }
	| { kind: "error"; message: string };

export function ProjectDetailView({
	project,
	stats,
	onBack,
	onEdit,
	onDelete,
}: ProjectDetailViewProps) {
	const [tab, setTab] = useState<"overview" | "progress" | "git" | "settings">(
		"overview",
	);
	const [isEditing, setIsEditing] = useState(false);
	const [name, setName] = useState(project.content);
	const [description, setDescription] = useState(project.description ?? "");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [range, setRange] = useState<{ start?: number; end?: number }>(() => {
		const now = new Date();
		return {
			start: startOfDay(subDays(now, 29)).getTime(),
			end: endOfDay(now).getTime(),
		};
	});
	const [captureOpen, setCaptureOpen] = useState(false);
	const [capture, setCapture] = useState<CaptureState>({ kind: "idle" });
	const [progress, setProgress] = useState<{
		events: Event[];
		isLoading: boolean;
		error: string | null;
	}>({ events: [], isLoading: false, error: null });
	const [git, setGit] = useState<{
		repoCount: number;
		commits: GitCommitType[];
		sessions: RepoWorkSession[];
		isLoading: boolean;
		error: string | null;
	}>({
		repoCount: 0,
		commits: [],
		sessions: [],
		isLoading: false,
		error: null,
	});
	const [coverIdx, setCoverIdx] = useState(0);
	const [sessionSummaries, setSessionSummaries] = useState<
		Record<string, { loading: boolean; summary: string | null }>
	>({});
	const projectIdRef = useRef(project.id);
	const nameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		projectIdRef.current = project.id;
		setTab("overview");
		setIsEditing(false);
		setShowDeleteConfirm(false);
		setIsDeleting(false);
		setCoverIdx(0);
		setCaptureOpen(false);
		setCapture({ kind: "idle" });
		setSessionSummaries({});
	}, [project.id]);

	useEffect(() => {
		if (isEditing) return;
		setName(project.content);
		setDescription(project.description ?? "");
	}, [isEditing, project.content, project.description]);

	useEffect(() => {
		if (!isEditing) return;
		nameInputRef.current?.focus();
	}, [isEditing]);

	const updateRange = useCallback((start?: number, end?: number) => {
		setRange({ start, end });
	}, []);

	const coverCandidates = useMemo(
		() => stats?.coverCandidates ?? [],
		[stats?.coverCandidates],
	);
	useEffect(() => {
		if (coverCandidates.length === 0) {
			setCoverIdx(0);
			return;
		}
		setCoverIdx(0);
	}, [coverCandidates]);

	const coverPath = coverCandidates[coverIdx] ?? null;

	const fetchProgress = useCallback(async () => {
		if (!window.api) return;
		setProgress((s) => ({ ...s, isLoading: true, error: null }));
		try {
			const events = await window.api.storage.getEvents({
				project: project.content,
				projectProgress: true,
				dismissed: false,
				limit: 5000,
				...(range.start ? { startDate: range.start } : {}),
				...(range.end ? { endDate: range.end } : {}),
			});
			setProgress({ events, isLoading: false, error: null });
		} catch (error) {
			setProgress((s) => ({ ...s, isLoading: false, error: String(error) }));
		}
	}, [project.content, range.end, range.start]);

	const fetchGit = useCallback(async () => {
		if (!window.api) return;
		setGit((s) => ({ ...s, isLoading: true, error: null }));
		try {
			const startAt = range.start ?? 0;
			const endAt = range.end ?? 0;
			const result = await window.api.projectJournal.getActivity({
				projectName: project.content,
				startAt,
				endAt,
				limitPerRepo: 5000,
			});
			setGit({
				repoCount: result.repos.length,
				commits: result.commits,
				sessions: result.sessions,
				isLoading: false,
				error: null,
			});
		} catch (error) {
			setGit((s) => ({ ...s, isLoading: false, error: String(error) }));
		}
	}, [project.content, range.end, range.start]);

	const refreshProgress = useCallback(() => {
		void fetchProgress();
	}, [fetchProgress]);

	const refreshGit = useCallback(() => {
		void fetchGit();
	}, [fetchGit]);

	useEffect(() => {
		refreshProgress();
	}, [refreshProgress]);

	useEffect(() => {
		if (tab !== "git") return;
		refreshGit();
	}, [refreshGit, tab]);

	useEffect(() => {
		if (!window.api) return;
		const offCreated = window.api.on("event:created", fetchProgress);
		const offUpdated = window.api.on("event:updated", fetchProgress);
		const offChanged = window.api.on("events:changed", fetchProgress);
		const offProjects = window.api.on("projects:normalized", fetchProgress);
		return () => {
			offCreated();
			offUpdated();
			offChanged();
			offProjects();
		};
	}, [fetchProgress]);

	const progressItems = useMemo(() => {
		const items: ProgressTimelineItem[] = [];
		for (const e of progress.events) {
			items.push({ kind: "event", timestamp: e.timestamp, event: e });
		}
		items.sort((a, b) => b.timestamp - a.timestamp);
		return items;
	}, [progress.events]);

	const groupedProgress = useMemo(
		() => groupEventsByDate(progressItems),
		[progressItems],
	);

	const progressActiveDays = useMemo(() => {
		const set = new Set<string>();
		for (const e of progress.events) {
			set.add(new Date(e.timestamp).toDateString());
		}
		return set.size;
	}, [progress.events]);

	const latestProgressAt = useMemo(
		() => progress.events[0]?.timestamp ?? null,
		[progress.events],
	);

	const sessions = useMemo(() => {
		const copy = [...git.sessions];
		copy.sort((a, b) => {
			const aEnd = a.isOpen ? Date.now() : a.endAt;
			const bEnd = b.isOpen ? Date.now() : b.endAt;
			return bEnd - aEnd;
		});
		return copy;
	}, [git.sessions]);

	const generateSessionSummary = useCallback(
		async (sessionId: string) => {
			if (!window.api) return;
			setSessionSummaries((prev) => ({
				...prev,
				[sessionId]: { loading: true, summary: null },
			}));
			try {
				const summary = await window.api.projectJournal.generateSessionSummary({
					sessionId,
					projectName: project.content,
				});
				setSessionSummaries((prev) => ({
					...prev,
					[sessionId]: { loading: false, summary },
				}));
			} catch {
				setSessionSummaries((prev) => ({
					...prev,
					[sessionId]: { loading: false, summary: null },
				}));
			}
		},
		[project.content],
	);

	const commitItems = useMemo(() => {
		const items: ProgressTimelineItem[] = [];
		for (const c of git.commits) {
			items.push({ kind: "commit", timestamp: c.timestamp, commit: c });
		}
		items.sort((a, b) => b.timestamp - a.timestamp);
		return items;
	}, [git.commits]);

	const groupedCommits = useMemo(
		() => groupEventsByDate(commitItems),
		[commitItems],
	);

	const openEdit = useCallback(() => {
		setTab("overview");
		setIsEditing(true);
	}, []);

	const handleSave = useCallback(async () => {
		if (!name.trim()) return;
		setIsSaving(true);
		try {
			await onEdit(project.id, {
				content: name.trim(),
				description: description.trim() || null,
			});
			setIsEditing(false);
		} finally {
			setIsSaving(false);
		}
	}, [description, name, onEdit, project.id]);

	const handleCancel = useCallback(() => {
		setName(project.content);
		setDescription(project.description ?? "");
		setIsEditing(false);
	}, [project.content, project.description]);

	const handleDelete = useCallback(async () => {
		setIsDeleting(true);
		try {
			await onDelete(project.id);
			onBack();
		} finally {
			setIsDeleting(false);
		}
	}, [onBack, onDelete, project.id]);

	const startProgressCapture = useCallback(async () => {
		if (!window.api) return;
		const runProjectId = projectIdRef.current;
		setCaptureOpen(true);
		setCapture({ kind: "capturing" });
		try {
			const result = await window.api.capture.trigger({
				intent: "project_progress",
			});
			if (projectIdRef.current !== runProjectId) return;
			if (!result.eventId) {
				setCapture({ kind: "error", message: "Capture failed" });
				return;
			}
			const event = await window.api.storage.getEvent(result.eventId);
			if (projectIdRef.current !== runProjectId) return;
			if (!event) {
				setCapture({ kind: "error", message: "Capture not found" });
				return;
			}
			const fallbackPath = event.originalPath ?? event.thumbnailPath ?? null;
			const highResPath = highResPathFromLowResPath(event.originalPath);
			const previewPath = highResPath ?? fallbackPath;
			setCapture({
				kind: "ready",
				eventId: result.eventId,
				caption: "",
				previewPath,
				fallbackPath,
				highResPath,
			});
		} catch {
			if (projectIdRef.current !== runProjectId) return;
			setCapture({ kind: "error", message: "Capture failed" });
		}
	}, []);

	const closeCapture = useCallback(async () => {
		if (!window.api) {
			setCaptureOpen(false);
			setCapture({ kind: "idle" });
			return;
		}
		if (capture.kind === "ready") {
			await window.api.storage.deleteEvent(capture.eventId);
		}
		setCaptureOpen(false);
		setCapture({ kind: "idle" });
	}, [capture.kind, capture]);

	const submitCapture = useCallback(async () => {
		if (!window.api) return;
		if (capture.kind !== "ready") return;
		const { eventId, caption } = capture;
		setCapture((prev) =>
			prev.kind === "ready" ? { ...prev, kind: "saving" } : prev,
		);
		try {
			await window.api.storage.submitProjectProgressCapture({
				id: eventId,
				caption: caption.trim(),
				project: project.content,
			});
			setCaptureOpen(false);
			setCapture({ kind: "idle" });
			void fetchProgress();
		} catch {
			setCapture((prev) =>
				prev.kind === "saving"
					? { ...prev, kind: "ready" }
					: prev.kind === "ready"
						? prev
						: prev,
			);
		}
	}, [capture, fetchProgress, project.content]);

	const coverHint = useMemo(() => {
		if (stats?.coverCandidates?.length) return "Latest capture";
		if (stats?.eventCount) return "Latest activity";
		return "No captures yet";
	}, [stats?.coverCandidates?.length, stats?.eventCount]);

	const derivedCover = useMemo(() => {
		if (!coverPath) return null;
		return { src: `local-file://${coverPath}` };
	}, [coverPath]);

	const overviewEventCount = stats?.eventCount ?? 0;
	const overviewLastActivity =
		stats?.lastEventAt != null ? formatRelativeTime(stats.lastEventAt) : null;

	return (
		<div className="h-full flex flex-col">
			<div className="drag-region flex border-b border-border p-2 px-4 items-center gap-3">
				<Button
					variant="ghost"
					size="sm"
					onClick={onBack}
					className="no-drag -ml-2"
				>
					<ArrowLeft className="h-4 w-4 mr-1.5" />
					Back
				</Button>

				<div className="flex-1 min-w-0">
					<h1 className="text-lg font-semibold truncate">{project.content}</h1>
				</div>

				<div className="flex items-center gap-2 no-drag">
					<Button
						size="sm"
						variant="outline"
						onClick={startProgressCapture}
						disabled={!window.api}
					>
						<Camera className="h-4 w-4 mr-2" />
						Capture
					</Button>
					<Button size="sm" variant="ghost" onClick={openEdit}>
						<Pencil className="h-4 w-4 mr-2" />
						Edit
					</Button>
				</div>
			</div>

			<Dialog
				open={captureOpen}
				onOpenChange={(open) => {
					if (open) {
						setCaptureOpen(true);
						return;
					}
					void closeCapture();
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Project progress</DialogTitle>
						<DialogDescription>
							Add a caption for {project.content}
						</DialogDescription>
					</DialogHeader>

					{capture.kind === "capturing" ? (
						<div className="flex items-center justify-center rounded-xl border border-border bg-muted/30 p-10">
							<Loader2 className="size-6 animate-spin text-muted-foreground" />
						</div>
					) : capture.kind === "error" ? (
						<div className="rounded-xl border border-border bg-muted/30 p-6">
							<div className="text-sm text-foreground/90">
								{capture.message}
							</div>
							<div className="mt-4 flex justify-end gap-2">
								<Button variant="outline" onClick={() => void closeCapture()}>
									Close
								</Button>
								<Button onClick={startProgressCapture}>Retry</Button>
							</div>
						</div>
					) : capture.kind === "ready" || capture.kind === "saving" ? (
						<div className="space-y-4">
							<div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
								{capture.previewPath ? (
									<img
										src={`local-file://${capture.previewPath}`}
										alt=""
										className="w-full max-h-[420px] object-contain"
										onError={() => {
											setCapture((prev) => {
												if (prev.kind !== "ready" && prev.kind !== "saving")
													return prev;
												if (
													!prev.highResPath ||
													prev.previewPath !== prev.highResPath
												)
													return prev;
												if (!prev.fallbackPath) return prev;
												return { ...prev, previewPath: prev.fallbackPath };
											});
										}}
									/>
								) : (
									<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
										No image
									</div>
								)}
							</div>

							<div className="space-y-2">
								<Textarea
									value={capture.caption}
									onChange={(e) => {
										const value = e.target.value;
										setCapture((prev) =>
											prev.kind === "ready"
												? { ...prev, caption: value }
												: prev,
										);
									}}
									placeholder="What changed?"
									className="min-h-[120px] resize-none"
									disabled={capture.kind === "saving"}
									onKeyDown={(e) => {
										const isSend =
											(e.metaKey || e.ctrlKey) && e.key === "Enter";
										if (!isSend) return;
										e.preventDefault();
										void submitCapture();
									}}
								/>
								<div className="flex items-center justify-between text-[11px] text-muted-foreground">
									<span>{capture.kind === "saving" ? "Saving…" : ""}</span>
									<span>{capture.caption.trim().length}/5000</span>
								</div>
							</div>
						</div>
					) : (
						<div className="rounded-xl border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
							Waiting…
						</div>
					)}

					{capture.kind === "ready" || capture.kind === "saving" ? (
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => void closeCapture()}
								disabled={capture.kind === "saving"}
							>
								Cancel
							</Button>
							<Button
								onClick={() => void submitCapture()}
								disabled={capture.kind === "saving"}
							>
								{capture.kind === "saving" ? (
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								) : (
									<Check className="h-4 w-4 mr-2" />
								)}
								<span>Save</span>
								<ShortcutKbd
									accelerator="CommandOrControl+Enter"
									className="h-4 px-1 text-[9px] rounded-sm"
								/>
							</Button>
						</DialogFooter>
					) : null}
				</DialogContent>
			</Dialog>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-5xl mx-auto space-y-6">
					<Tabs
						value={tab}
						onValueChange={(v) =>
							setTab(v as "overview" | "progress" | "git" | "settings")
						}
					>
						<TabsList className="no-drag">
							<TabsTrigger value="overview">Overview</TabsTrigger>
							<TabsTrigger value="progress">Progress</TabsTrigger>
							<TabsTrigger value="git">Git</TabsTrigger>
							<TabsTrigger value="settings">Settings</TabsTrigger>
						</TabsList>

						<TabsContent value="overview">
							<div className="grid gap-6 lg:grid-cols-[1.35fr,0.65fr]">
								<div className="rounded-xl border border-border bg-card overflow-hidden">
									<div className="relative aspect-video bg-muted">
										{derivedCover ? (
											<img
												src={derivedCover.src}
												alt=""
												className="w-full h-full object-cover"
												loading="lazy"
												onError={() => {
													setCoverIdx((v) =>
														v + 1 < coverCandidates.length ? v + 1 : v,
													);
												}}
											/>
										) : (
											<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
												No image
											</div>
										)}

										<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
											<div className="flex items-end justify-between gap-3">
												<div className="min-w-0">
													<div className="text-sm font-medium text-white/90 truncate">
														{project.content}
													</div>
													<div className="mt-1 text-xs text-white/70">
														{coverHint}
													</div>
												</div>
												{overviewEventCount > 0 ? (
													<Badge className="bg-black/60 text-white border border-white/10">
														<Calendar className="h-3 w-3 mr-1.5 opacity-80" />
														{overviewEventCount}
													</Badge>
												) : null}
											</div>
										</div>
									</div>

									<div className="p-5 space-y-4">
										<div className="flex items-center justify-between gap-3">
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												<span>
													Created {formatRelativeTime(project.createdAt)}
												</span>
												{project.updatedAt !== project.createdAt ? (
													<span>
														• Updated {formatRelativeTime(project.updatedAt)}
													</span>
												) : null}
											</div>
											{!isEditing ? (
												<Button
													variant="ghost"
													size="sm"
													className="-mr-2"
													onClick={openEdit}
												>
													<Pencil className="h-4 w-4 mr-2" />
													Edit
												</Button>
											) : null}
										</div>

										<div className="space-y-2">
											<div className="text-xs font-mono tracking-[0.22em] text-muted-foreground">
												PROJECT
											</div>
											{isEditing ? (
												<Input
													ref={nameInputRef}
													value={name}
													onChange={(e) => setName(e.target.value)}
													placeholder="Project name..."
													disabled={isSaving}
												/>
											) : (
												<div className="text-lg font-semibold text-foreground">
													{project.content}
												</div>
											)}
										</div>

										<div className="space-y-2">
											<div className="text-xs font-mono tracking-[0.22em] text-muted-foreground">
												DESCRIPTION
											</div>
											{isEditing ? (
												<Textarea
													value={description}
													onChange={(e) => setDescription(e.target.value)}
													placeholder="Notes, repos, stack, goals, recognition hints..."
													className="min-h-[120px] resize-none"
													disabled={isSaving}
												/>
											) : project.description ? (
												<div className="mt-1 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
													{project.description}
												</div>
											) : (
												<div className="mt-1 text-sm text-muted-foreground/60 italic">
													No description added
												</div>
											)}
										</div>

										{isEditing ? (
											<div className="flex justify-end gap-2 pt-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={handleCancel}
													disabled={isSaving}
												>
													<X className="h-4 w-4 mr-2" />
													Cancel
												</Button>
												<Button
													size="sm"
													onClick={() => void handleSave()}
													disabled={!name.trim() || isSaving}
												>
													{isSaving ? (
														<Loader2 className="h-4 w-4 mr-2 animate-spin" />
													) : (
														<Check className="h-4 w-4 mr-2" />
													)}
													Save
												</Button>
											</div>
										) : null}
									</div>
								</div>

								<div className="space-y-6">
									<div className="rounded-xl border border-border bg-card p-5">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="text-sm font-medium text-foreground">
													Metrics
												</div>
												<div className="mt-1 text-xs text-muted-foreground">
													Overview and quick context.
												</div>
											</div>
											<div className="flex items-center gap-2">
												<DateRangeSelect
													startDate={range.start}
													endDate={range.end}
													onChange={updateRange}
												/>
												<Button
													variant="outline"
													size="sm"
													onClick={refreshProgress}
													disabled={progress.isLoading}
												>
													<RefreshCcw className="h-4 w-4 mr-2" />
													Refresh
												</Button>
											</div>
										</div>

										<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
											<div className="rounded-lg border border-border bg-muted/10 p-3">
												<div className="text-xs text-muted-foreground">
													Events
												</div>
												<div className="mt-1 text-lg font-semibold">
													{overviewEventCount}
												</div>
											</div>
											<div className="rounded-lg border border-border bg-muted/10 p-3">
												<div className="text-xs text-muted-foreground">
													Progress captures
												</div>
												<div className="mt-1 text-lg font-semibold">
													{progress.events.length}
												</div>
											</div>
											<div className="rounded-lg border border-border bg-muted/10 p-3">
												<div className="text-xs text-muted-foreground">
													Active days
												</div>
												<div className="mt-1 text-lg font-semibold">
													{progressActiveDays}
												</div>
											</div>
											<div className="rounded-lg border border-border bg-muted/10 p-3">
												<div className="text-xs text-muted-foreground">
													Last progress
												</div>
												<div className="mt-1 text-sm font-medium">
													{latestProgressAt
														? formatRelativeTime(latestProgressAt)
														: "—"}
												</div>
											</div>
											<div className="rounded-lg border border-border bg-muted/10 p-3 col-span-2">
												<div className="text-xs text-muted-foreground">
													Last activity
												</div>
												<div className="mt-1 text-sm font-medium">
													{overviewLastActivity ?? "—"}
												</div>
											</div>
										</div>

										<div className="mt-4 flex flex-wrap gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() => setTab("progress")}
											>
												Open progress
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => setTab("git")}
											>
												Open git
											</Button>
										</div>
									</div>
								</div>
							</div>
						</TabsContent>

						<TabsContent value="progress">
							<div className="space-y-4">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<div className="flex items-center gap-2">
										<DateRangeSelect
											startDate={range.start}
											endDate={range.end}
											onChange={updateRange}
										/>
										<Button
											variant="outline"
											size="sm"
											onClick={refreshProgress}
											disabled={progress.isLoading}
										>
											<RefreshCcw className="h-4 w-4 mr-2" />
											Refresh
										</Button>
									</div>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{progress.events.length} captures</span>
										<span>•</span>
										<span>{progressActiveDays} days</span>
									</div>
								</div>

								{progress.error ? (
									<div className="rounded-xl border border-border bg-muted/10 p-3 text-sm text-destructive">
										{progress.error}
									</div>
								) : null}

								{progress.isLoading ? (
									<div className="h-[50vh] flex items-center justify-center">
										<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
									</div>
								) : progressItems.length === 0 ? (
									<div className="rounded-xl border border-border bg-muted/10 p-8 text-center">
										<div className="text-sm text-muted-foreground">
											No progress captures in this range.
										</div>
									</div>
								) : (
									<div className="space-y-8">
										{Array.from(groupedProgress.entries()).map(
											([date, items]) => (
												<ProgressTimelineGroup
													key={date}
													date={date}
													items={items}
													showProject={false}
													onUnmark={fetchProgress}
												/>
											),
										)}
									</div>
								)}
							</div>
						</TabsContent>

						<TabsContent value="git">
							<div className="space-y-6">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<div className="flex items-center gap-2">
										<DateRangeSelect
											startDate={range.start}
											endDate={range.end}
											onChange={updateRange}
										/>
										<Button
											variant="outline"
											size="sm"
											onClick={refreshGit}
											disabled={git.isLoading}
										>
											<RefreshCcw className="h-4 w-4 mr-2" />
											Refresh
										</Button>
									</div>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{git.repoCount} repos</span>
										<span>•</span>
										<span>{git.commits.length} commits</span>
										<span>•</span>
										<span>{git.sessions.length} sessions</span>
									</div>
								</div>

								<div className="space-y-2">
									<div className="text-sm font-medium text-foreground">
										Linked repositories
									</div>
									<ProjectRepoManager
										projectName={project.content}
										defaultOpen
									/>
								</div>

								{git.error ? (
									<div className="rounded-xl border border-border bg-muted/10 p-3 text-sm text-destructive">
										{git.error}
									</div>
								) : null}
								{!git.isLoading && git.repoCount === 0 ? (
									<div className="rounded-xl border border-border bg-muted/10 p-4 text-sm text-muted-foreground">
										No git repo linked for this project.
									</div>
								) : null}

								<div className="rounded-xl border border-border bg-card p-5">
									<div className="flex items-center justify-between gap-3">
										<div className="flex items-center gap-2">
											<GitCommit className="h-4 w-4 text-muted-foreground" />
											<div className="text-sm font-medium">Commits</div>
										</div>
										<Badge variant="secondary">{git.commits.length}</Badge>
									</div>

									<div className="mt-4">
										{git.isLoading ? (
											<div className="h-[30vh] flex items-center justify-center">
												<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
											</div>
										) : commitItems.length === 0 ? (
											<div className="rounded-lg border border-border bg-muted/10 p-4 text-sm text-muted-foreground">
												No commits in this range.
											</div>
										) : (
											<div className="space-y-8">
												{Array.from(groupedCommits.entries()).map(
													([date, items]) => (
														<ProgressTimelineGroup
															key={date}
															date={date}
															items={items}
															showProject={false}
														/>
													),
												)}
											</div>
										)}
									</div>
								</div>

								<div className="rounded-xl border border-border bg-card overflow-hidden">
									<div className="p-5 flex items-center justify-between gap-3">
										<div className="flex items-center gap-2">
											<Clock className="h-4 w-4 text-muted-foreground" />
											<div className="text-sm font-medium">Work sessions</div>
										</div>
										<Badge variant="secondary">{sessions.length}</Badge>
									</div>
									<div className="border-t border-border">
										{sessions.length === 0 ? (
											<div className="p-5 text-sm text-muted-foreground">
												No sessions in this range.
											</div>
										) : (
											<div className="divide-y divide-border">
												{sessions.slice(0, 25).map((s) => {
													const endAt = s.isOpen ? Date.now() : s.endAt;
													const summaryState = sessionSummaries[s.id];
													const displaySummary =
														s.summary ?? summaryState?.summary;
													const isLoadingSummary = summaryState?.loading;
													const canGenerateSummary =
														!s.isOpen &&
														!displaySummary &&
														!isLoadingSummary &&
														(s.files.length > 0 ||
															s.maxInsertions > 0 ||
															s.maxDeletions > 0);
													return (
														<div
															key={s.id}
															className="p-5 flex items-start justify-between gap-4"
														>
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-2">
																	<div className="text-sm font-medium truncate">
																		{repoLabel(s.repoRoot)}
																	</div>
																	{s.isOpen ? (
																		<Badge className="bg-primary/90 text-primary-foreground border-0">
																			Live
																		</Badge>
																	) : null}
																</div>
																<div className="mt-1 text-xs text-muted-foreground">
																	{formatTime(s.startAt)}–{formatTime(endAt)} ·{" "}
																	{sessionDurationLabel(s)}
																	{s.branch ? ` · ${s.branch}` : ""}
																</div>
																{displaySummary ? (
																	<div className="mt-2 text-sm text-foreground/80 italic">
																		{displaySummary}
																	</div>
																) : s.files.length > 0 ? (
																	<div className="mt-2 text-xs text-muted-foreground truncate">
																		{s.files.slice(0, 6).join(", ")}
																		{s.files.length > 6
																			? ` +${s.files.length - 6}`
																			: ""}
																	</div>
																) : null}
																{canGenerateSummary ? (
																	<button
																		type="button"
																		onClick={() => generateSessionSummary(s.id)}
																		className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
																	>
																		<Sparkles className="h-3 w-3" />
																		Generate summary
																	</button>
																) : null}
																{isLoadingSummary ? (
																	<div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
																		<Loader2 className="h-3 w-3 animate-spin" />
																		Generating…
																	</div>
																) : null}
															</div>
															<div className="shrink-0 text-xs text-muted-foreground">
																+{s.maxInsertions} −{s.maxDeletions}
															</div>
														</div>
													);
												})}
											</div>
										)}
									</div>
								</div>
							</div>
						</TabsContent>

						<TabsContent value="settings">
							<div className="space-y-6">
								<div className="rounded-xl border border-border bg-card p-5">
									<div className="text-sm font-medium">Settings</div>
									<div className="mt-1 text-xs text-muted-foreground">
										Edit name and description from the Overview tab.
									</div>
								</div>

								<div className="rounded-xl border border-border bg-card p-5">
									<div className="flex items-center justify-between gap-3">
										<div>
											<div className="text-sm font-medium text-destructive">
												Danger zone
											</div>
											<div className="mt-1 text-xs text-muted-foreground">
												Deletes the project memory. Does not delete captured
												events.
											</div>
										</div>
										{showDeleteConfirm ? (
											<div className="flex items-center gap-2">
												<Button
													variant="destructive"
													size="sm"
													onClick={() => void handleDelete()}
													disabled={isDeleting}
												>
													{isDeleting ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : (
														"Delete"
													)}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => setShowDeleteConfirm(false)}
													disabled={isDeleting}
												>
													Cancel
												</Button>
											</div>
										) : (
											<Button
												variant="destructive"
												size="sm"
												onClick={() => setShowDeleteConfirm(true)}
											>
												<Trash2 className="h-4 w-4 mr-2" />
												Delete project
											</Button>
										)}
									</div>
								</div>
							</div>
						</TabsContent>
					</Tabs>
				</div>
			</ScrollArea>
		</div>
	);
}
