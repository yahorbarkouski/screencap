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
import type {
	Event,
	Friend,
	GitCommit,
	ProjectShare,
	SharedProject,
	SocialIdentity,
} from "@/types";
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
	const [sharedEvents, setSharedEvents] = useState<
		Map<string, Event[]>
	>(new Map());
	const [identity, setIdentity] = useState<SocialIdentity | null>(null);
	const [isSyncing, setIsSyncing] = useState(false);

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

	const [friendsShareState, setFriendsShareState] = useState<{
		status: "idle" | "loading" | "creating" | "inviting" | "error";
		roomId: string | null;
		friends: Friend[];
		error: string | null;
	}>({
		status: "idle",
		roomId: null,
		friends: [],
		error: null,
	});

	useEffect(() => {
		if (!window.api?.social) return;
		void window.api.social.getIdentity().then(setIdentity);
	}, []);

	const fetchSharedProjects = useCallback(async () => {
		if (!window.api?.sharedProjects) return;
		try {
			const projects = await window.api.sharedProjects.list();
			setSharedProjects(projects);

			const { startDate, endDate } = rangeBounds(preset);
			const eventsMap = new Map<string, Event[]>();

			for (const project of projects) {
				const sharedEvts = await window.api.sharedProjects.getEvents({
					roomId: project.roomId,
					startDate,
					endDate,
					limit: 5000,
				});
				const unifiedEvents: Event[] = sharedEvts.map((se) => ({
					id: se.id,
					timestamp: se.timestampMs,
					endTimestamp: se.endTimestampMs,
					displayId: null,
					category: se.category,
					subcategories: null,
					project: se.project ?? project.projectName,
					projectProgress: se.projectProgress,
					projectProgressConfidence: null,
					projectProgressEvidence: null,
					tags: null,
					confidence: null,
					caption: se.caption,
					trackedAddiction: null,
					addictionCandidate: null,
					addictionConfidence: null,
					addictionPrompt: null,
					thumbnailPath: se.thumbnailPath,
					originalPath: se.originalPath,
					stableHash: null,
					detailHash: null,
					mergedCount: null,
					dismissed: 0,
					userLabel: null,
					status: "completed",
					appBundleId: se.appBundleId,
					appName: se.appName,
					appIconPath: null,
					windowTitle: se.windowTitle,
					urlHost: null,
					urlCanonical: null,
					faviconPath: null,
					screenshotCount: null,
					contentKind: se.contentKind,
					contentId: null,
					contentTitle: se.contentTitle,
					isFullscreen: 0,
					contextProvider: null,
					contextConfidence: null,
					contextKey: null,
					contextJson: null,
					authorUserId: se.authorUserId,
					authorUsername: se.authorUsername,
					isRemote: true,
				}));
				eventsMap.set(project.roomId, unifiedEvents);
			}

			setSharedEvents(eventsMap);
		} catch (error) {
			console.error("Failed to fetch shared projects:", error);
		}
	}, [preset]);

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

	const localProjects = useMemo(() => uniqueProjects(allEvents), [allEvents]);

	const projectOptions = useMemo((): ProjectOption[] => {
		const options: ProjectOption[] = [];
		const seenNames = new Set<string>();

		for (const name of localProjects) {
			const sharedProject = sharedProjects.find(
				(sp) => sp.projectName.toLowerCase() === name.toLowerCase(),
			);
			options.push({
				value: name,
				label: sharedProject ? `${name} [shared]` : name,
				isShared: !!sharedProject,
				roomId: sharedProject?.roomId,
			});
			seenNames.add(name.toLowerCase());
		}

		for (const sp of sharedProjects) {
			if (!seenNames.has(sp.projectName.toLowerCase())) {
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

	const visibleEvents = useMemo(() => {
		if (!selectedProject) return allEvents;
		if (selectedProject.startsWith("shared:")) return [];
		return allEvents.filter((e) => e.project === selectedProject);
	}, [allEvents, selectedProject]);

	const currentProjectOption = useMemo(
		() => projectOptions.find((p) => p.value === selectedProject),
		[projectOptions, selectedProject],
	);

	const visibleSharedEvents = useMemo((): Event[] => {
		if (!selectedProject) {
			const result: Event[] = [];
			for (const sp of sharedProjects) {
				const events = sharedEvents.get(sp.roomId) ?? [];
				result.push(...events);
			}
			return result;
		}

		if (selectedProject.startsWith("shared:")) {
			const roomId = selectedProject.replace("shared:", "");
			return sharedEvents.get(roomId) ?? [];
		}

		if (currentProjectOption?.roomId) {
			return sharedEvents.get(currentProjectOption.roomId) ?? [];
		}

		return [];
	}, [
		selectedProject,
		sharedProjects,
		sharedEvents,
		currentProjectOption,
	]);

	const timelineItems = useMemo(() => {
		const items: ProgressTimelineItem[] = visibleEvents.map((e) => ({
			kind: "event",
			timestamp: e.timestamp,
			event: e,
			isMe: false,
		}));

		for (const se of visibleSharedEvents) {
			items.push({
				kind: "event",
				timestamp: se.timestamp,
				event: se,
				isMe: identity?.userId === se.authorUserId,
			});
		}

		for (const c of git.commits) {
			items.push({ kind: "commit", timestamp: c.timestamp, commit: c });
		}

		items.sort((a, b) => b.timestamp - a.timestamp);
		return items;
	}, [git.commits, visibleEvents, visibleSharedEvents, identity]);

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

	const loadFriendsForSharing = useCallback(async () => {
		if (!window.api?.social) return;
		setFriendsShareState((s) => ({ ...s, status: "loading", error: null }));
		try {
			const friends = await window.api.social.listFriends();
			setFriendsShareState((s) => ({
				...s,
				status: "idle",
				friends,
				error: null,
			}));
		} catch (error) {
			setFriendsShareState((s) => ({
				...s,
				status: "error",
				error: String(error),
			}));
		}
	}, []);

	useEffect(() => {
		if (!shareDialogOpen) return;
		if (!selectedProject) return;
		if (!window.api?.social) return;
		void loadFriendsForSharing();
	}, [loadFriendsForSharing, selectedProject, shareDialogOpen]);

	const ensureProjectRoom = useCallback(async () => {
		if (!selectedProject || !window.api?.rooms) return;
		setFriendsShareState((s) => ({ ...s, status: "creating", error: null }));
		try {
			const roomId = await window.api.rooms.ensureProjectRoom(selectedProject);
			setFriendsShareState((s) => ({ ...s, roomId, status: "idle" }));
		} catch (error) {
			setFriendsShareState((s) => ({
				...s,
				status: "error",
				error: String(error),
			}));
		}
	}, [selectedProject]);

	const inviteFriend = useCallback(
		async (friendUserId: string) => {
			if (!selectedProject || !window.api?.rooms) return;
			setFriendsShareState((s) => ({ ...s, status: "inviting", error: null }));
			try {
				await window.api.rooms.inviteFriendToProjectRoom(
					selectedProject,
					friendUserId,
				);
				setFriendsShareState((s) => ({ ...s, status: "idle" }));
			} catch (error) {
				setFriendsShareState((s) => ({
					...s,
					status: "error",
					error: String(error),
				}));
			}
		},
		[selectedProject],
	);

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

					{selectedProject &&
						!selectedProject.startsWith("shared:") &&
						window.api?.publishing && (
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

							<div className="pt-4 border-t border-border/60 space-y-3">
								<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
									FRIENDS
								</div>

								{friendsShareState.error && (
									<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
										{friendsShareState.error}
									</div>
								)}

								{friendsShareState.roomId ? (
									<div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground/90">
										Room linked:{" "}
										<span className="font-mono text-xs">
											{friendsShareState.roomId}
										</span>
									</div>
								) : (
									<Button
										variant="outline"
										onClick={ensureProjectRoom}
										disabled={
											friendsShareState.status === "creating" ||
											!window.api?.rooms
										}
									>
										Enable friend sharing
									</Button>
								)}

								{friendsShareState.friends.length === 0 ? (
									<div className="text-sm text-muted-foreground">
										Add friends from the tray popup to invite them here.
									</div>
								) : (
									<div className="space-y-2">
										{friendsShareState.friends.map((f) => (
											<div
												key={f.userId}
												className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2"
											>
												<div className="text-sm text-foreground">
													@{f.username}
												</div>
												<Button
													size="sm"
													variant="outline"
													onClick={() => inviteFriend(f.userId)}
													disabled={
														!window.api?.rooms ||
														!friendsShareState.roomId ||
														friendsShareState.status === "inviting"
													}
												>
													Invite
												</Button>
											</div>
										))}
									</div>
								)}
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

							<div className="pt-4 border-t border-border/60 space-y-3">
								<div className="text-xs font-mono tracking-[0.18em] text-muted-foreground">
									FRIENDS
								</div>

								{friendsShareState.error && (
									<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
										{friendsShareState.error}
									</div>
								)}

								{friendsShareState.roomId ? (
									<div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground/90">
										Room linked:{" "}
										<span className="font-mono text-xs">
											{friendsShareState.roomId}
										</span>
									</div>
								) : (
									<Button
										variant="outline"
										onClick={ensureProjectRoom}
										disabled={
											friendsShareState.status === "creating" ||
											!window.api?.rooms
										}
									>
										Enable friend sharing
									</Button>
								)}

								{friendsShareState.friends.length === 0 ? (
									<div className="text-sm text-muted-foreground">
										Add friends from the tray popup to invite them here.
									</div>
								) : (
									<div className="space-y-2">
										{friendsShareState.friends.map((f) => (
											<div
												key={f.userId}
												className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2"
											>
												<div className="text-sm text-foreground">
													@{f.username}
												</div>
												<Button
													size="sm"
													variant="outline"
													onClick={() => inviteFriend(f.userId)}
													disabled={
														!window.api?.rooms ||
														!friendsShareState.roomId ||
														friendsShareState.status === "inviting"
													}
												>
													Invite
												</Button>
											</div>
										))}
									</div>
								)}
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
