import { endOfDay, startOfDay, subDays } from "date-fns";
import { Calendar, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	cn,
	groupEventsByDate,
	normalizeProjectName,
	sharedEventToEvent,
} from "@/lib/utils";
import type { Event, GitCommit, SharedProject, SocialIdentity } from "@/types";
import {
	ProgressTimelineGroup,
	type ProgressTimelineItem,
} from "./ProgressTimelineGroup";

type RangePreset = "today" | "7d" | "30d" | "all";

type ProjectOption = {
	value: string;
	label: string;
	isShared: boolean;
	roomId?: string;
};

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

	const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);
	const [identity, setIdentity] = useState<SocialIdentity | null>(null);
	const [isSyncing, setIsSyncing] = useState(false);

	useEffect(() => {
		if (!window.api?.social) return;
		void window.api.social.getIdentity().then(setIdentity);
	}, []);

	const fetchSharedProjects = useCallback(async () => {
		if (!window.api?.sharedProjects) return;
		try {
			const projects = await window.api.sharedProjects.list();
			setSharedProjects(projects);
		} catch (error) {
			console.error("Failed to fetch shared projects:", error);
		}
	}, []);

	const syncAllSharedProjects = useCallback(async () => {
		if (!window.api?.sharedProjects) return;
		setIsSyncing(true);
		try {
			await window.api.sharedProjects.syncAll();
			await fetchSharedProjects();
		} finally {
			setIsSyncing(false);
		}
	}, [fetchSharedProjects]);

	useEffect(() => {
		void fetchSharedProjects();
	}, [fetchSharedProjects]);

	const fetchEvents = useCallback(async () => {
		if (!window.api) return;
		setIsLoading(true);
		try {
			const { startDate, endDate } = rangeBounds(preset);

			if (selectedProject?.startsWith("shared:")) {
				const roomId = selectedProject.replace("shared:", "");
				const sharedEvts = await window.api.sharedProjects.getEvents({
					roomId,
					startDate,
					endDate,
					limit: 5000,
				});
				setAllEvents(sharedEvts.map(sharedEventToEvent));
				return;
			}

			const events = await window.api.storage.getUnifiedEvents({
				startDate,
				endDate,
				projectProgress: true,
				dismissed: false,
				limit: 5000,
				...(selectedProject ? { project: selectedProject } : {}),
			});
			setAllEvents(events);
		} finally {
			setIsLoading(false);
		}
	}, [preset, selectedProject]);

	useEffect(() => {
		void fetchEvents();
	}, [fetchEvents]);

	const localProjects = useMemo(() => uniqueProjects(allEvents), [allEvents]);

	const projectOptions = useMemo((): ProjectOption[] => {
		const options: ProjectOption[] = [];
		const seenNames = new Set<string>();

		for (const name of localProjects) {
			const normalized = normalizeProjectName(name);
			const sharedProject = sharedProjects.find(
				(sp) => normalizeProjectName(sp.projectName) === normalized,
			);
			options.push({
				value: name,
				label: sharedProject ? `${name} [shared]` : name,
				isShared: !!sharedProject,
				roomId: sharedProject?.roomId,
			});
			seenNames.add(normalized);
		}

		for (const sp of sharedProjects) {
			if (!seenNames.has(normalizeProjectName(sp.projectName))) {
				options.push({
					value: `shared:${sp.roomId}`,
					label: `${sp.projectName} [shared]`,
					isShared: true,
					roomId: sp.roomId,
				});
			}
		}

		return options.sort((a, b) =>
			a.value.localeCompare(b.value, undefined, { sensitivity: "base" }),
		);
	}, [localProjects, sharedProjects]);

	const fetchGit = useCallback(async () => {
		if (!window.api) {
			setGit({ repoCount: 0, commits: [], isLoading: false, error: null });
			return;
		}

		const { startDate, endDate } = rangeBounds(preset);
		const startAt = startDate ?? 0;
		const endAt = endDate ?? 0;

		const projectsToFetch = selectedProject
			? selectedProject.startsWith("shared:")
				? []
				: [selectedProject]
			: localProjects;
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
	}, [preset, selectedProject, localProjects]);

	useEffect(() => {
		void fetchGit();
	}, [fetchGit]);

	useEffect(() => {
		if (!selectedProject && projectOptions.length === 1) {
			setSelectedProject(projectOptions[0].value);
		}
	}, [projectOptions, selectedProject]);

	useEffect(() => {
		const allValues = projectOptions.map((p) => p.value);
		if (selectedProject && !allValues.includes(selectedProject)) {
			setSelectedProject(undefined);
		}
	}, [projectOptions, selectedProject]);

	const timelineItems = useMemo(() => {
		const items: ProgressTimelineItem[] = allEvents.map((e) => ({
			kind: "event",
			timestamp: e.timestamp,
			event: e,
			isMe: e.isRemote ? identity?.userId === e.authorUserId : true,
		}));

		for (const c of git.commits) {
			items.push({ kind: "commit", timestamp: c.timestamp, commit: c });
		}

		items.sort((a, b) => b.timestamp - a.timestamp);
		return items;
	}, [git.commits, allEvents, identity]);

	const groupedItems = useMemo(
		() => groupEventsByDate(timelineItems),
		[timelineItems],
	);
	const showProject = selectedProject == null;

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
					{sharedProjects.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-2 text-xs gap-1.5"
							onClick={syncAllSharedProjects}
							disabled={isSyncing}
						>
							<RefreshCw
								className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")}
							/>
							Sync
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
						options={projectOptions}
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
		</div>
	);
}
