import { endOfDay, startOfDay, subDays } from "date-fns";
import {
	Calendar,
	Check,
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
	Share2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, groupEventsByDate } from "@/lib/utils";
import type { Event, GitCommit, ProjectShare } from "@/types";
import {
	ProgressTimelineGroup,
	type ProgressTimelineItem,
} from "./ProgressTimelineGroup";

type RangePreset = "today" | "7d" | "30d" | "all";

function rangeBounds(preset: RangePreset): {
	startDate?: number;
	endDate?: number;
} {
	if (preset === "all") return {};
	const now = new Date();
	const endDate = endOfDay(now).getTime();
	if (preset === "today")
		return { startDate: startOfDay(now).getTime(), endDate };
	const days = preset === "7d" ? 6 : 29;
	const startDate = startOfDay(subDays(now, days)).getTime();
	return { startDate, endDate };
}

function uniqueProjects(events: Event[]): string[] {
	const set = new Set<string>();
	for (const e of events) {
		if (!e.project) continue;
		set.add(e.project);
	}
	return Array.from(set).sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base" }),
	);
}

export function ProjectProgressView() {
	const [preset, setPreset] = useState<RangePreset>("30d");
	const [allEvents, setAllEvents] = useState<Event[]>([]);
	const [selectedProject, setSelectedProject] = useState<string | undefined>(
		undefined,
	);
	const [isLoading, setIsLoading] = useState(true);
	const [git, setGit] = useState<{
		repoCount: number;
		commits: GitCommit[];
		isLoading: boolean;
		error: string | null;
	}>({ repoCount: 0, commits: [], isLoading: false, error: null });

	const [shareDialogOpen, setShareDialogOpen] = useState(false);
	const [shareState, setShareState] = useState<{
		status: "idle" | "loading" | "creating" | "syncing" | "error";
		share: ProjectShare | null;
		error: string | null;
		copied: boolean;
		syncedCount: number | null;
	}>({
		status: "idle",
		share: null,
		error: null,
		copied: false,
		syncedCount: null,
	});

	const fetchEvents = useCallback(async () => {
		if (!window.api) return;
		setIsLoading(true);
		try {
			const { startDate, endDate } = rangeBounds(preset);
			const events = await window.api.storage.getEvents({
				startDate,
				endDate,
				projectProgress: true,
				dismissed: false,
				limit: 5000,
			});
			setAllEvents(events);
		} finally {
			setIsLoading(false);
		}
	}, [preset]);

	useEffect(() => {
		void fetchEvents();
	}, [fetchEvents]);

	const projects = useMemo(() => uniqueProjects(allEvents), [allEvents]);

	const fetchGit = useCallback(async () => {
		if (!window.api) {
			setGit({ repoCount: 0, commits: [], isLoading: false, error: null });
			return;
		}

		const { startDate, endDate } = rangeBounds(preset);
		const startAt = startDate ?? 0;
		const endAt = endDate ?? 0;

		const projectsToFetch = selectedProject ? [selectedProject] : projects;
		if (projectsToFetch.length === 0) {
			setGit({ repoCount: 0, commits: [], isLoading: false, error: null });
			return;
		}

		setGit((s) => ({ ...s, isLoading: true, error: null }));
		try {
			const results = await Promise.all(
				projectsToFetch.map((projectName) =>
					window.api.projectJournal.getActivity({
						projectName,
						startAt,
						endAt,
						limitPerRepo: 5000,
					}),
				),
			);
			const allCommits = results.flatMap((r) => r.commits);
			const totalRepos = results.reduce((sum, r) => sum + r.repos.length, 0);
			setGit({
				repoCount: totalRepos,
				commits: allCommits,
				isLoading: false,
				error: null,
			});
		} catch (error) {
			setGit((s) => ({ ...s, isLoading: false, error: String(error) }));
		}
	}, [preset, selectedProject, projects]);

	useEffect(() => {
		void fetchGit();
	}, [fetchGit]);

	useEffect(() => {
		if (!selectedProject && projects.length === 1) {
			setSelectedProject(projects[0]);
		}
	}, [projects, selectedProject]);

	useEffect(() => {
		if (selectedProject && !projects.includes(selectedProject)) {
			setSelectedProject(undefined);
		}
	}, [projects, selectedProject]);

	const visibleEvents = useMemo(
		() =>
			selectedProject
				? allEvents.filter((e) => e.project === selectedProject)
				: allEvents,
		[allEvents, selectedProject],
	);

	const timelineItems = useMemo(() => {
		const items: ProgressTimelineItem[] = visibleEvents.map((e) => ({
			kind: "event",
			timestamp: e.timestamp,
			event: e,
		}));

		for (const c of git.commits) {
			items.push({ kind: "commit", timestamp: c.timestamp, commit: c });
		}

		items.sort((a, b) => b.timestamp - a.timestamp);
		return items;
	}, [git.commits, visibleEvents]);

	const groupedItems = useMemo(
		() => groupEventsByDate(timelineItems),
		[timelineItems],
	);
	const showProject = selectedProject == null;

	const openShareDialog = useCallback(async () => {
		if (!selectedProject || !window.api?.publishing) return;

		setShareDialogOpen(true);
		setShareState({
			status: "loading",
			share: null,
			error: null,
			copied: false,
			syncedCount: null,
		});

		try {
			const existing = await window.api.publishing.getShare(selectedProject);
			if (existing) {
				setShareState({
					status: "idle",
					share: existing,
					error: null,
					copied: false,
					syncedCount: null,
				});
			} else {
				setShareState({
					status: "idle",
					share: null,
					error: null,
					copied: false,
					syncedCount: null,
				});
			}
		} catch (error) {
			setShareState({
				status: "error",
				share: null,
				error: String(error),
				copied: false,
				syncedCount: null,
			});
		}
	}, [selectedProject]);

	const createShare = useCallback(async () => {
		if (!selectedProject || !window.api?.publishing) return;

		setShareState((s) => ({ ...s, status: "creating", error: null }));

		try {
			const result = await window.api.publishing.createShare(selectedProject);
			const share: ProjectShare = {
				projectName: selectedProject,
				publicId: result.publicId,
				writeKey: result.writeKey,
				shareUrl: result.shareUrl,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				lastPublishedAt: null,
			};
			setShareState({
				status: "idle",
				share,
				error: null,
				copied: false,
				syncedCount: null,
			});
		} catch (error) {
			setShareState((s) => ({ ...s, status: "error", error: String(error) }));
		}
	}, [selectedProject]);

	const disableShare = useCallback(async () => {
		if (!selectedProject || !window.api?.publishing) return;

		setShareState((s) => ({ ...s, status: "loading" }));

		try {
			await window.api.publishing.disableShare(selectedProject);
			setShareState({
				status: "idle",
				share: null,
				error: null,
				copied: false,
				syncedCount: null,
			});
		} catch (error) {
			setShareState((s) => ({ ...s, status: "error", error: String(error) }));
		}
	}, [selectedProject]);

	const syncShare = useCallback(async () => {
		if (!selectedProject || !window.api?.publishing) return;

		setShareState((s) => ({ ...s, status: "syncing", syncedCount: null }));

		try {
			const count = await window.api.publishing.syncShare(selectedProject);
			setShareState((s) => ({ ...s, status: "idle", syncedCount: count }));
		} catch (error) {
			setShareState((s) => ({ ...s, status: "error", error: String(error) }));
		}
	}, [selectedProject]);

	const copyShareUrl = useCallback(() => {
		if (!shareState.share) return;
		void navigator.clipboard.writeText(shareState.share.shareUrl);
		setShareState((s) => ({ ...s, copied: true }));
		setTimeout(() => {
			setShareState((s) => ({ ...s, copied: false }));
		}, 2000);
	}, [shareState.share]);

	const openShareUrl = useCallback(() => {
		if (!shareState.share || !window.api?.app) return;
		void window.api.app.openExternal(shareState.share.shareUrl);
	}, [shareState.share]);

	return (
		<div className="h-full flex flex-col">
			<div className="drag-region flex items-start justify-between gap-4 border-b border-border p-2 px-4">
				<div className="flex flex-col">
					<h1 className="text-lg font-semibold">Project progress</h1>
					<p className="text-sm text-muted-foreground">
						Visual milestones detected from captures.
					</p>
				</div>

				<div className="flex items-center gap-2 no-drag pt-2">
					{selectedProject && window.api?.publishing && (
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-2 text-xs gap-1.5"
							onClick={openShareDialog}
						>
							<Share2 className="h-3.5 w-3.5" />
							Share
						</Button>
					)}

					<Combobox
						value={selectedProject}
						onValueChange={(v) => setSelectedProject(v)}
						placeholder="Project"
						allLabel="All Projects"
						searchable
						searchPlaceholder="Search projects..."
						emptyText="No projects."
						options={projects.map((p) => ({ value: p, label: p }))}
						className="w-[200px] no-drag"
					/>

					<div className="inline-flex items-center rounded-md border border-input bg-muted/20 p-0.5">
						{(
							[
								{ key: "today", label: "Today", icon: Calendar },
								{ key: "7d", label: "7d" },
								{ key: "30d", label: "30d" },
								{ key: "all", label: "All" },
							] as const
						).map((p) => {
							const active = preset === p.key;
							const Icon = "icon" in p ? p.icon : null;
							return (
								<Button
									key={p.key}
									variant="ghost"
									size="sm"
									className={cn(
										"h-7 px-2 text-xs",
										active && "bg-background shadow-sm",
									)}
									onClick={() => setPreset(p.key)}
								>
									{Icon && <Icon className="h-4 w-4" />}
									{p.label}
								</Button>
							);
						})}
					</div>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 space-y-8">
					{git.isLoading || git.error ? (
						<div className="rounded-lg border border-border bg-muted/10 p-3 text-sm">
							{git.error ? (
								<div className="text-destructive">{git.error}</div>
							) : (
								<div className="flex items-center gap-2 text-muted-foreground">
									<Loader2 className="h-4 w-4 animate-spin" />
									Loading commits…
								</div>
							)}
						</div>
					) : null}
					{isLoading ? (
						<div className="h-[60vh] flex items-center justify-center">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : timelineItems.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-muted-foreground">
								No progress events or commits in this range.
							</p>
						</div>
					) : (
						Array.from(groupedItems.entries()).map(([date, items]) => (
							<ProgressTimelineGroup
								key={date}
								date={date}
								items={items}
								showProject={showProject}
								onUnmark={fetchEvents}
							/>
						))
					)}
				</div>
			</ScrollArea>

			<Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Share progress</DialogTitle>
						<DialogDescription>
							{selectedProject
								? `Share "${selectedProject}" progress publicly`
								: "Select a project to share"}
						</DialogDescription>
					</DialogHeader>

					{shareState.status === "loading" ||
					shareState.status === "creating" ||
					shareState.status === "syncing" ? (
						<div className="flex flex-col items-center justify-center py-8 gap-2">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							{shareState.status === "syncing" && (
								<p className="text-xs text-muted-foreground">
									Syncing progress...
								</p>
							)}
						</div>
					) : shareState.error ? (
						<div className="space-y-4">
							<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								{shareState.error}
							</div>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => setShareDialogOpen(false)}
								>
									Close
								</Button>
							</div>
						</div>
					) : shareState.share ? (
						<div className="space-y-4">
							<div className="rounded-lg border border-border bg-muted/30 p-3">
								<div className="flex items-center gap-2">
									<input
										type="text"
										readOnly
										value={shareState.share.shareUrl}
										className="flex-1 bg-transparent text-sm text-foreground outline-none"
									/>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 w-8 p-0"
										onClick={copyShareUrl}
									>
										{shareState.copied ? (
											<Check className="h-4 w-4 text-emerald-500" />
										) : (
											<Copy className="h-4 w-4" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 w-8 p-0"
										onClick={openShareUrl}
									>
										<ExternalLink className="h-4 w-4" />
									</Button>
								</div>
							</div>

							<p className="text-xs text-muted-foreground">
								New progress captures for this project will be automatically
								published to this page.
							</p>

							{shareState.syncedCount !== null && (
								<p className="text-xs text-emerald-500">
									Synced {shareState.syncedCount} events
								</p>
							)}

							<div className="flex justify-between gap-2">
								<div className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={disableShare}
									>
										<X className="h-4 w-4 mr-1.5" />
										Stop sharing
									</Button>
									<Button variant="ghost" size="sm" onClick={syncShare}>
										<RefreshCw className="h-4 w-4 mr-1.5" />
										Sync
									</Button>
								</div>
								<Button onClick={() => setShareDialogOpen(false)}>Done</Button>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								Create a public page to share your project progress. Anyone with
								the link can view your progress updates.
							</p>

							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => setShareDialogOpen(false)}
								>
									Cancel
								</Button>
								<Button onClick={createShare}>
									<Share2 className="h-4 w-4 mr-1.5" />
									Create share link
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
