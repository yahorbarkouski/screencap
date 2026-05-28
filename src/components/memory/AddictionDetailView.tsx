import { endOfDay, startOfDay, subDays } from "date-fns";
import {
	ArrowLeft,
	Check,
	Flame,
	Loader2,
	Pencil,
	RefreshCcw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangeSelect } from "@/components/ui/date-range-select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ContributionCalendar } from "@/components/wrapped/ContributionCalendar";
import { type CountItem, CountList } from "@/components/wrapped/CountList";
import { Metric } from "@/components/wrapped/Metric";
import { Panel } from "@/components/wrapped/Panel";
import type { AddictionStats } from "@/hooks/useAddictionStats";
import { countCoveredSlots, SLOT_MINUTES } from "@/lib/dayline";
import {
	cn,
	formatDurationCompact,
	formatRelativeTime,
	groupEventsByDate,
	limitGroupedItems,
} from "@/lib/utils";
import type { Event, Memory } from "@/types";
import { EventCard } from "../timeline/EventCard";

const RISK_CALENDAR_LEVELS = [
	"bg-muted/50",
	"bg-destructive/15",
	"bg-destructive/25",
	"bg-destructive/40",
	"bg-destructive/60",
] as const;

const EPISODE_BATCH_SIZE = 120;

function formatSignedInt(value: number): string {
	return `${value >= 0 ? "+" : ""}${value}`;
}

function topCounts(values: Array<string | null>, n: number): CountItem[] {
	const counts = new Map<string, number>();
	for (const v of values) {
		if (!v) continue;
		const key = v.trim();
		if (!key) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Array.from(counts.entries())
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, n);
}

function eventSource(e: Event): string | null {
	return e.urlHost ?? e.appName ?? null;
}

interface AddictionDetailViewProps {
	addiction: Memory;
	stats?: AddictionStats;
	onBack: () => void;
	onEdit: (
		id: string,
		updates: { content: string; description?: string | null },
	) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}

export function AddictionDetailView({
	addiction,
	stats,
	onBack,
	onEdit,
	onDelete,
}: AddictionDetailViewProps) {
	const [tab, setTab] = useState<"overview" | "episodes" | "settings">(
		"overview",
	);
	const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
	const [isEditing, setIsEditing] = useState(false);
	const [name, setName] = useState(addiction.content);
	const [description, setDescription] = useState(addiction.description ?? "");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [range, setRange] = useState<{ start?: number; end?: number }>(() => {
		const now = new Date();
		return {
			start: startOfDay(subDays(now, 55)).getTime(),
			end: endOfDay(now).getTime(),
		};
	});
	const [eventsState, setEventsState] = useState<{
		events: Event[];
		isLoading: boolean;
		error: string | null;
	}>({ events: [], isLoading: false, error: null });
	const [visibleEpisodeCount, setVisibleEpisodeCount] =
		useState(EPISODE_BATCH_SIZE);
	const [coverIdx, setCoverIdx] = useState(0);
	const addictionIdRef = useRef(addiction.id);
	const refreshDebounceRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		addictionIdRef.current = addiction.id;
		setTab("overview");
		setSelectedDay(startOfDay(new Date()));
		setIsEditing(false);
		setShowDeleteConfirm(false);
		setIsDeleting(false);
		setEventsState({ events: [], isLoading: false, error: null });
		setVisibleEpisodeCount(EPISODE_BATCH_SIZE);
		setCoverIdx(0);
	}, [addiction.id]);

	useEffect(() => {
		if (isEditing) return;
		setName(addiction.content);
		setDescription(addiction.description ?? "");
	}, [isEditing, addiction.content, addiction.description]);

	const updateRange = useCallback((start?: number, end?: number) => {
		setRange({ start, end });
		setVisibleEpisodeCount(EPISODE_BATCH_SIZE);
	}, []);

	const fetchEvents = useCallback(async () => {
		if (!window.api) return;
		const runId = addictionIdRef.current;
		setEventsState((s) => ({ ...s, isLoading: true, error: null }));
		try {
			const events = await window.api.storage.getEvents({
				trackedAddiction: addiction.content,
				...(range.start ? { startDate: range.start } : {}),
				...(range.end ? { endDate: range.end } : {}),
				limit: 5000,
			});
			if (addictionIdRef.current !== runId) return;
			setEventsState({ events, isLoading: false, error: null });
		} catch (error) {
			if (addictionIdRef.current !== runId) return;
			setEventsState((s) => ({ ...s, isLoading: false, error: String(error) }));
		}
	}, [addiction.content, range.end, range.start]);

	useEffect(() => {
		void fetchEvents();
	}, [fetchEvents]);

	const debouncedFetchEvents = useCallback(() => {
		if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
		refreshDebounceRef.current = setTimeout(fetchEvents, 5_000);
	}, [fetchEvents]);

	useEffect(() => {
		if (!window.api) return;
		const offCreated = window.api.on("event:created", debouncedFetchEvents);
		const offUpdated = window.api.on("event:updated", debouncedFetchEvents);
		const offChanged = window.api.on("events:changed", debouncedFetchEvents);
		return () => {
			if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
			offCreated();
			offUpdated();
			offChanged();
		};
	}, [debouncedFetchEvents]);

	const incidentsInRange = eventsState.events.length;

	const riskMinutesInRange = useMemo(() => {
		const byDay = new Map<number, Event[]>();
		for (const e of eventsState.events) {
			const day = startOfDay(new Date(e.timestamp)).getTime();
			const arr = byDay.get(day);
			if (arr) arr.push(e);
			else byDay.set(day, [e]);
		}

		let slots = 0;
		for (const [dayStartMs, dayEvents] of byDay.entries()) {
			slots += countCoveredSlots(dayEvents, dayStartMs);
		}
		return slots * SLOT_MINUTES;
	}, [eventsState.events]);

	const dayCounts = useMemo(() => {
		const m = new Map<number, number>();
		for (const e of eventsState.events) {
			const day = startOfDay(new Date(e.timestamp)).getTime();
			m.set(day, (m.get(day) ?? 0) + 1);
		}
		return m;
	}, [eventsState.events]);

	const maxDayCount = useMemo(() => {
		let max = 0;
		for (const v of dayCounts.values()) {
			if (v > max) max = v;
		}
		return max;
	}, [dayCounts]);

	const topSources = useMemo(
		() => topCounts(eventsState.events.map(eventSource), 5),
		[eventsState.events],
	);

	const coverCandidates = useMemo(
		() => stats?.coverCandidates ?? [],
		[stats?.coverCandidates],
	);
	const firstCoverCandidate = coverCandidates[0] ?? null;
	useEffect(() => {
		setCoverIdx(0);
		if (!firstCoverCandidate) return;
	}, [firstCoverCandidate]);
	const coverPath = coverCandidates[coverIdx] ?? null;

	const lastIncidentAt = stats?.lastIncidentAt ?? null;
	const cleanFor = lastIncidentAt
		? formatDurationCompact(Date.now() - lastIncidentAt)
		: null;

	const weekCount = stats?.weekCount ?? 0;
	const weekDeltaValue = weekCount - (stats?.prevWeekCount ?? 0);
	const weekDeltaLabel =
		weekCount > 0 || (stats?.prevWeekCount ?? 0) > 0
			? formatSignedInt(weekDeltaValue)
			: undefined;
	const weekDeltaTone =
		weekDeltaValue < 0 ? "up" : weekDeltaValue > 0 ? "down" : "neutral";

	const selectedDayCount = useMemo(() => {
		const dayStart = startOfDay(selectedDay).getTime();
		return dayCounts.get(dayStart) ?? 0;
	}, [dayCounts, selectedDay]);

	const openEdit = useCallback(() => {
		setTab("settings");
		setIsEditing(true);
	}, []);

	const handleSave = useCallback(async () => {
		if (!name.trim()) return;
		setIsSaving(true);
		try {
			await onEdit(addiction.id, {
				content: name.trim(),
				description: description.trim() || null,
			});
			setIsEditing(false);
		} finally {
			setIsSaving(false);
		}
	}, [addiction.id, description, name, onEdit]);

	const handleCancel = useCallback(() => {
		setName(addiction.content);
		setDescription(addiction.description ?? "");
		setIsEditing(false);
	}, [addiction.content, addiction.description]);

	const handleDelete = useCallback(async () => {
		setIsDeleting(true);
		try {
			await onDelete(addiction.id);
			onBack();
		} finally {
			setIsDeleting(false);
		}
	}, [addiction.id, onBack, onDelete]);

	const groupedEvents = useMemo(() => {
		const sorted = [...eventsState.events].sort(
			(a, b) => b.timestamp - a.timestamp,
		);
		return groupEventsByDate(sorted);
	}, [eventsState.events]);
	const visibleGroupedEvents = useMemo(
		() => limitGroupedItems(groupedEvents, visibleEpisodeCount),
		[groupedEvents, visibleEpisodeCount],
	);

	const lastIncidentLabel = lastIncidentAt
		? formatRelativeTime(lastIncidentAt)
		: null;

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
					<h1 className="text-lg font-semibold truncate">
						{addiction.content}
					</h1>
				</div>

				<div className="flex items-center gap-2 no-drag">
					<Button
						size="sm"
						variant="outline"
						onClick={() => void fetchEvents()}
					>
						<RefreshCcw
							className={cn(
								"h-4 w-4 mr-2",
								eventsState.isLoading ? "animate-spin" : "",
							)}
						/>
						Refresh
					</Button>
					<Button size="sm" variant="ghost" onClick={openEdit}>
						<Pencil className="h-4 w-4 mr-2" />
						Edit
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-5xl mx-auto space-y-6">
					<Tabs
						value={tab}
						onValueChange={(v) =>
							setTab(v as "overview" | "episodes" | "settings")
						}
					>
						<TabsList className="no-drag">
							<TabsTrigger value="overview">Overview</TabsTrigger>
							<TabsTrigger value="episodes">Episodes</TabsTrigger>
							<TabsTrigger value="settings">Settings</TabsTrigger>
						</TabsList>

						<TabsContent value="overview">
							<div className="grid gap-6 lg:grid-cols-[1.35fr,0.65fr]">
								<div className="rounded-xl border border-border bg-card overflow-hidden">
									<div className="relative aspect-video bg-muted">
										{coverPath ? (
											<img
												src={`local-file://${coverPath}`}
												alt=""
												className="w-full h-full object-cover"
												loading="lazy"
												draggable={false}
												onError={() => {
													setCoverIdx((v) =>
														v + 1 < coverCandidates.length ? v + 1 : v,
													);
												}}
											/>
										) : (
											<>
												<div className="absolute inset-0 bg-gradient-to-br from-destructive/20 via-muted/40 to-background/40" />
												<div className="relative h-full w-full flex items-center justify-center">
													<Flame className="h-14 w-14 text-destructive/80" />
												</div>
											</>
										)}
										<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
											<div className="flex items-end justify-between gap-3">
												<div className="min-w-0">
													<div className="text-sm font-medium text-white/90 truncate">
														{addiction.content}
													</div>
													<div className="mt-1 text-xs text-white/70">
														{lastIncidentLabel
															? `Last incident ${lastIncidentLabel}`
															: "No incidents yet"}
													</div>
												</div>
												{weekCount > 0 ? (
													<Badge className="bg-black/60 text-white border border-white/10">
														{weekCount} · 7d
													</Badge>
												) : null}
											</div>
										</div>
									</div>

									<div className="p-5 space-y-3">
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											<span>
												Created {formatRelativeTime(addiction.createdAt)}
											</span>
											{addiction.updatedAt !== addiction.createdAt ? (
												<span>
													• Updated {formatRelativeTime(addiction.updatedAt)}
												</span>
											) : null}
										</div>

										<div>
											<div className="text-xs font-mono tracking-[0.22em] text-muted-foreground">
												DETAILS
											</div>
											{addiction.description ? (
												<div className="mt-2 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
													{addiction.description}
												</div>
											) : (
												<div className="mt-2 text-sm text-muted-foreground/60 italic">
													No details added
												</div>
											)}
										</div>

										<div className="mt-4 flex items-center gap-2">
											<DateRangeSelect
												startDate={range.start}
												endDate={range.end}
												onChange={updateRange}
											/>
										</div>
									</div>
								</div>

								<div className="space-y-6">
									<div className="grid grid-cols-2 gap-3">
										<Metric
											label="Clean streak"
											value={cleanFor ?? "—"}
											detail={
												lastIncidentLabel
													? `Last incident ${lastIncidentLabel}`
													: "—"
											}
										/>
										<Metric
											label="Incidents (7d)"
											value={String(weekCount)}
											delta={weekDeltaLabel}
											deltaTone={weekDeltaTone}
										/>
										<Metric
											label="Incidents (range)"
											value={String(incidentsInRange)}
										/>
										<Metric
											label="Risk minutes (range)"
											value={formatDurationCompact(riskMinutesInRange * 60_000)}
										/>
									</div>

									<Panel
										title="Calendar"
										meta={`${selectedDayCount} incident${selectedDayCount === 1 ? "" : "s"} on selected day`}
									>
										<ContributionCalendar
											selectedDay={selectedDay}
											onSelectDay={setSelectedDay}
											dayCounts={dayCounts}
											maxCount={maxDayCount}
											levelClasses={RISK_CALENDAR_LEVELS}
											selectedClassName="ring-2 ring-destructive ring-offset-2 ring-offset-background"
										/>
									</Panel>

									<CountList title="Top sources" items={topSources} />
								</div>
							</div>
						</TabsContent>

						<TabsContent value="episodes">
							<div className="space-y-4">
								<div className="flex items-center justify-between gap-3 flex-wrap">
									<DateRangeSelect
										startDate={range.start}
										endDate={range.end}
										onChange={updateRange}
									/>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<span>{incidentsInRange} events</span>
									</div>
								</div>

								{eventsState.error ? (
									<div className="rounded-xl border border-border bg-muted/10 p-3 text-sm text-destructive">
										{eventsState.error}
									</div>
								) : null}

								{eventsState.isLoading ? (
									<div className="h-[50vh] flex items-center justify-center">
										<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
									</div>
								) : incidentsInRange === 0 ? (
									<div className="rounded-xl border border-border bg-muted/10 p-8 text-center">
										<div className="text-sm text-muted-foreground">
											No incidents in this range.
										</div>
									</div>
								) : (
									<div className="space-y-10">
										{visibleGroupedEvents.entries.map(([date, events]) => (
											<div key={date}>
												<div className="mb-4 text-sm font-medium text-muted-foreground">
													{date}
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
													{events.map((event) => (
														<EventCard
															key={event.id}
															event={event}
															showProject
														/>
													))}
												</div>
											</div>
										))}
										{visibleGroupedEvents.hasMore ? (
											<div className="flex justify-center">
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														setVisibleEpisodeCount(
															(count) => count + EPISODE_BATCH_SIZE,
														)
													}
												>
													Show more
												</Button>
											</div>
										) : null}
									</div>
								)}
							</div>
						</TabsContent>

						<TabsContent value="settings">
							<div className="space-y-6">
								<div className="rounded-xl border border-border bg-card p-5">
									<div className="flex items-center justify-between gap-3">
										<div>
											<div className="text-sm font-medium">
												Addiction details
											</div>
											<div className="mt-1 text-xs text-muted-foreground">
												Name is used for detection and tracking.
											</div>
										</div>
										{!isEditing ? (
											<Button variant="outline" size="sm" onClick={openEdit}>
												<Pencil className="h-4 w-4 mr-2" />
												Edit
											</Button>
										) : null}
									</div>

									{isEditing ? (
										<div className="mt-4 space-y-4">
											<div className="space-y-2">
												<div className="text-xs font-mono tracking-[0.22em] text-muted-foreground">
													NAME
												</div>
												<Input
													value={name}
													onChange={(e) => setName(e.target.value)}
													placeholder="Addiction name..."
													autoFocus
												/>
											</div>

											<div className="space-y-2">
												<div className="text-xs font-mono tracking-[0.22em] text-muted-foreground">
													DETAILS
												</div>
												<Textarea
													value={description}
													onChange={(e) => setDescription(e.target.value)}
													placeholder="Sites, apps, or rules to help detection..."
													className="min-h-[140px] resize-none"
												/>
											</div>

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
										</div>
									) : (
										<div className="mt-4 space-y-4">
											<div>
												<div className="text-xs text-muted-foreground">
													Name
												</div>
												<div className="mt-1 text-sm font-medium">
													{addiction.content}
												</div>
											</div>
											<div>
												<div className="text-xs text-muted-foreground">
													Details
												</div>
												{addiction.description ? (
													<div className="mt-1 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
														{addiction.description}
													</div>
												) : (
													<div className="mt-1 text-sm text-muted-foreground/60 italic">
														No details added
													</div>
												)}
											</div>
										</div>
									)}
								</div>

								<div className="rounded-xl border border-border bg-card p-5">
									<div className="flex items-center justify-between gap-3">
										<div>
											<div className="text-sm font-medium text-destructive">
												Danger zone
											</div>
											<div className="mt-1 text-xs text-muted-foreground">
												Deletes the addiction memory. Does not delete captured
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
												Delete addiction
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
