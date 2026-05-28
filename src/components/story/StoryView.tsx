import {
	addDays,
	endOfDay,
	format,
	startOfDay,
	startOfWeek,
	subDays,
} from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { migrateContentToV2 } from "@/components/eod/EndOfDayFlow.utils";
import { AddMemoryDialog } from "@/components/memory/AddMemoryDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemories } from "@/hooks/useMemories";
import {
	computeDaylineSlots,
	countCoveredSlots,
	SLOT_MINUTES,
	SLOTS_PER_HOUR,
} from "@/lib/dayline";
import { useAppStore } from "@/stores/app";
import type { EodContentV2, EodEntry, Event } from "@/types";
import {
	type DaylineViewMode,
	StoryViewHeader,
	StoryViewMain,
	StoryViewSidebar,
} from "./StoryView.sections";
import {
	type CategoryStat,
	computeAddictionStreak,
	isRiskEvent,
	type JournalScope,
	longestRun,
	riskRule,
	riskSource,
	topCounts,
} from "./StoryView.utils";

const CALENDAR_WEEKS = 8;
const EPISODES_PAGE_SIZE = 15;
const PROGRESS_ALL = "__all__";

export function StoryView() {
	const settings = useAppStore((s) => s.settings);
	const openEod = useAppStore((s) => s.openEod);
	const { addictions, createMemory, editMemory, deleteMemory } = useMemories();

	const [selectedDay, setSelectedDay] = useState<Date>(() =>
		startOfDay(new Date()),
	);
	const [dayEvents, setDayEvents] = useState<Event[]>([]);
	const [dayStats, setDayStats] = useState<CategoryStat[]>([]);
	const [prevDayEvents, setPrevDayEvents] = useState<Event[]>([]);
	const [prevDayStats, setPrevDayStats] = useState<CategoryStat[]>([]);
	const [calendarEvents, setCalendarEvents] = useState<Event[]>([]);
	const [scope, setScope] = useState<JournalScope>("all");
	const [addAddictionDialogOpen, setAddAddictionDialogOpen] = useState(false);
	const [episodesPage, setEpisodesPage] = useState(0);
	const [progressProject, setProgressProject] = useState<string>(PROGRESS_ALL);
	const [daylineMode, setDaylineMode] = useState<DaylineViewMode>("categories");
	const [eodEntries, setEodEntries] = useState<EodEntry[]>([]);
	const [currentEodEntry, setCurrentEodEntry] = useState<EodEntry | null>(null);

	const showJournal = scope !== "addiction";
	const showAddiction = scope !== "journal";

	const selectedStartMs = useMemo(
		() => startOfDay(selectedDay).getTime(),
		[selectedDay],
	);
	const selectedEndMs = useMemo(
		() => endOfDay(selectedDay).getTime(),
		[selectedDay],
	);
	const prevStartMs = useMemo(
		() => startOfDay(subDays(selectedDay, 1)).getTime(),
		[selectedDay],
	);

	const todayStartMs = startOfDay(new Date()).getTime();
	const isToday = selectedStartMs === todayStartMs;

	const prevEndMs = useMemo(() => {
		if (isToday) {
			const elapsed = Date.now() - selectedStartMs;
			return prevStartMs + elapsed;
		}
		return endOfDay(subDays(selectedDay, 1)).getTime();
	}, [isToday, prevStartMs, selectedDay, selectedStartMs]);

	const fetchEodEntries = useCallback(async () => {
		if (!window.api) return;
		const result = await window.api.eod.listEntries();
		setEodEntries(result);
	}, []);

	const fetchCurrentEodEntry = useCallback(async () => {
		if (!window.api) return;
		const entry = await window.api.eod.getEntryByDayStart(selectedStartMs);
		setCurrentEodEntry(entry);
	}, [selectedStartMs]);

	const fetchDay = useCallback(async () => {
		if (!window.api) return;
		const [events, stats] = await Promise.all([
			window.api.storage.getEvents({
				startDate: selectedStartMs,
				endDate: selectedEndMs,
				dismissed: false,
			}),
			window.api.storage.getStats(selectedStartMs, selectedEndMs),
		]);

		setDayEvents(events);
		setDayStats(stats);
	}, [selectedEndMs, selectedStartMs]);

	const fetchPrevDay = useCallback(async () => {
		if (!window.api) return;
		const [events, stats] = await Promise.all([
			window.api.storage.getEvents({
				startDate: prevStartMs,
				endDate: prevEndMs,
				dismissed: false,
			}),
			window.api.storage.getStats(prevStartMs, prevEndMs),
		]);

		setPrevDayEvents(events);
		setPrevDayStats(stats);
	}, [prevEndMs, prevStartMs]);

	const fetchCalendar = useCallback(async () => {
		const today = startOfDay(new Date());
		const end = endOfDay(today).getTime();
		const start = startOfWeek(subDays(today, CALENDAR_WEEKS * 7 - 1), {
			weekStartsOn: 1,
		}).getTime();
		const events = await window.api.storage.getEvents({
			startDate: start,
			endDate: end,
			dismissed: false,
		});
		setCalendarEvents(events);
	}, []);

	useEffect(() => {
		fetchEodEntries();
		fetchCalendar();
	}, [fetchCalendar, fetchEodEntries]);

	useEffect(() => {
		fetchDay();
		fetchPrevDay();
		fetchCurrentEodEntry();
	}, [fetchDay, fetchPrevDay, fetchCurrentEodEntry]);

	const slots = useMemo(
		() =>
			computeDaylineSlots(dayEvents, selectedStartMs, {
				showDominantWebsites: settings.showDominantWebsites,
			}),
		[dayEvents, selectedStartMs, settings.showDominantWebsites],
	);

	const prevSlots = useMemo(
		() =>
			computeDaylineSlots(prevDayEvents, prevStartMs, {
				showDominantWebsites: settings.showDominantWebsites,
			}),
		[prevDayEvents, prevStartMs, settings.showDominantWebsites],
	);

	const activeSlots = useMemo(() => slots.map((s) => s.count > 0), [slots]);
	const activeSlotCount = useMemo(
		() => activeSlots.filter(Boolean).length,
		[activeSlots],
	);
	const activeMinutes = activeSlotCount * SLOT_MINUTES;
	const longestStreakMinutes = useMemo(
		() => longestRun(activeSlots) * SLOT_MINUTES,
		[activeSlots],
	);

	const prevActiveSlots = useMemo(
		() => prevSlots.map((s) => s.count > 0),
		[prevSlots],
	);
	const prevActiveSlotCount = useMemo(
		() => prevActiveSlots.filter(Boolean).length,
		[prevActiveSlots],
	);
	const prevActiveMinutes = prevActiveSlotCount * SLOT_MINUTES;
	const prevLongestStreakMinutes = useMemo(
		() => longestRun(prevActiveSlots) * SLOT_MINUTES,
		[prevActiveSlots],
	);

	const topApps = useMemo(
		() =>
			topCounts(
				dayEvents.map((e) => e.appName),
				3,
			),
		[dayEvents],
	);
	const topSites = useMemo(
		() =>
			topCounts(
				dayEvents.map((e) => e.urlHost),
				3,
			),
		[dayEvents],
	);
	const topProjects = useMemo(
		() =>
			topCounts(
				dayEvents.map((e) => e.project),
				3,
			),
		[dayEvents],
	);

	const dayProgressEvents = useMemo(
		() =>
			dayEvents
				.filter((e) => !!e.project && e.projectProgress === 1)
				.sort((a, b) => b.timestamp - a.timestamp),
		[dayEvents],
	);

	const progressProjects = useMemo(() => {
		const set = new Set<string>();
		for (const e of dayProgressEvents) {
			if (e.project) set.add(e.project);
		}
		return Array.from(set).sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
	}, [dayProgressEvents]);

	useEffect(() => {
		if (
			progressProject !== PROGRESS_ALL &&
			!progressProjects.includes(progressProject)
		) {
			setProgressProject(PROGRESS_ALL);
		}
	}, [progressProject, progressProjects]);

	const filteredProgressEvents = useMemo(() => {
		if (progressProject === PROGRESS_ALL) return dayProgressEvents;
		return dayProgressEvents.filter((e) => e.project === progressProject);
	}, [dayProgressEvents, progressProject]);

	const showProgressProject =
		progressProject === PROGRESS_ALL && progressProjects.length > 1;

	const focusPct = useMemo(() => {
		const total = dayStats.reduce((sum, s) => sum + s.count, 0);
		const focus = dayStats
			.filter((s) => s.category === "Work" || s.category === "Study")
			.reduce((sum, s) => sum + s.count, 0);
		if (total <= 0) return 0;
		return Math.round((focus / total) * 100);
	}, [dayStats]);

	const prevFocusPct = useMemo(() => {
		const total = prevDayStats.reduce((sum, s) => sum + s.count, 0);
		const focus = prevDayStats
			.filter((s) => s.category === "Work" || s.category === "Study")
			.reduce((sum, s) => sum + s.count, 0);
		if (total <= 0) return null;
		return Math.round((focus / total) * 100);
	}, [prevDayStats]);

	const uniqueApps = useMemo(
		() => new Set(dayEvents.map((e) => e.appName).filter(Boolean)).size,
		[dayEvents],
	);

	const uniqueSites = useMemo(
		() => new Set(dayEvents.map((e) => e.urlHost).filter(Boolean)).size,
		[dayEvents],
	);

	const dayRiskEvents = useMemo(
		() =>
			dayEvents.filter(isRiskEvent).sort((a, b) => b.timestamp - a.timestamp),
		[dayEvents],
	);

	const confirmedRiskEvents = dayRiskEvents;

	const episodesTotalPages = useMemo(
		() => Math.ceil(dayRiskEvents.length / EPISODES_PAGE_SIZE),
		[dayRiskEvents.length],
	);

	const episodesPageClamped = useMemo(() => {
		if (episodesTotalPages <= 0) return 0;
		return Math.min(episodesPage, episodesTotalPages - 1);
	}, [episodesPage, episodesTotalPages]);

	useEffect(() => {
		if (episodesPage !== episodesPageClamped)
			setEpisodesPage(episodesPageClamped);
	}, [episodesPage, episodesPageClamped]);

	const episodesMeta = useMemo(() => {
		if (dayRiskEvents.length <= 0) return "0 events";
		if (episodesTotalPages <= 1) return `${dayRiskEvents.length} events`;
		const start = episodesPageClamped * EPISODES_PAGE_SIZE + 1;
		const end = Math.min(dayRiskEvents.length, start + EPISODES_PAGE_SIZE - 1);
		return `${dayRiskEvents.length} events · ${start}–${end}`;
	}, [dayRiskEvents.length, episodesPageClamped, episodesTotalPages]);

	const episodesPageEvents = useMemo(() => {
		const start = episodesPageClamped * EPISODES_PAGE_SIZE;
		return dayRiskEvents.slice(start, start + EPISODES_PAGE_SIZE);
	}, [dayRiskEvents, episodesPageClamped]);

	const firstRiskSeen = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		for (const e of dayRiskEvents) {
			if (e.timestamp < min) min = e.timestamp;
		}
		return Number.isFinite(min) ? min : null;
	}, [dayRiskEvents]);

	const lastRiskSeen = useMemo(() => {
		let max = Number.NEGATIVE_INFINITY;
		for (const e of dayRiskEvents) {
			const end = e.endTimestamp ?? e.timestamp;
			if (end > max) max = end;
		}
		return Number.isFinite(max) ? max : null;
	}, [dayRiskEvents]);

	const topRiskAddictions = useMemo(
		() => topCounts(dayRiskEvents.map(riskRule), 3),
		[dayRiskEvents],
	);

	const topRiskSources = useMemo(
		() => topCounts(dayRiskEvents.map(riskSource), 3),
		[dayRiskEvents],
	);

	const dominantAddiction = topRiskAddictions[0]?.label ?? "—";

	const firstSeen = useMemo(() => {
		let min = Number.POSITIVE_INFINITY;
		for (const e of dayEvents) {
			if (e.timestamp < min) min = e.timestamp;
		}
		return Number.isFinite(min) ? min : null;
	}, [dayEvents]);

	const lastSeen = useMemo(() => {
		let max = Number.NEGATIVE_INFINITY;
		for (const e of dayEvents) {
			if (e.timestamp > max) max = e.timestamp;
		}
		return Number.isFinite(max) ? max : null;
	}, [dayEvents]);

	const peakHour = useMemo(() => {
		const hourCounts = Array.from({ length: 24 }, () => 0);
		slots.forEach((s, idx) => {
			hourCounts[Math.floor(idx / SLOTS_PER_HOUR)] += s.count;
		});
		let bestHour = 0;
		let bestCount = 0;
		hourCounts.forEach((c, h) => {
			if (c > bestCount) {
				bestCount = c;
				bestHour = h;
			}
		});
		return bestCount > 0 ? { hour: bestHour, count: bestCount } : null;
	}, [slots]);

	const dayCounts = useMemo(() => {
		const m = new Map<number, number>();
		for (const e of calendarEvents) {
			const day = startOfDay(new Date(e.timestamp)).getTime();
			m.set(day, (m.get(day) ?? 0) + 1);
		}
		return m;
	}, [calendarEvents]);

	const maxDayCount = useMemo(() => {
		let max = 0;
		for (const v of dayCounts.values()) {
			if (v > max) max = v;
		}
		return max;
	}, [dayCounts]);

	const calendarRiskEvents = useMemo(
		() => calendarEvents.filter(isRiskEvent),
		[calendarEvents],
	);

	const riskDayCounts = useMemo(() => {
		const m = new Map<number, number>();
		for (const e of calendarRiskEvents) {
			const day = startOfDay(new Date(e.timestamp)).getTime();
			m.set(day, (m.get(day) ?? 0) + 1);
		}
		return m;
	}, [calendarRiskEvents]);

	const maxRiskDayCount = useMemo(() => {
		let max = 0;
		for (const v of riskDayCounts.values()) {
			if (v > max) max = v;
		}
		return max;
	}, [riskDayCounts]);

	const addictionStreak = useMemo(
		() => computeAddictionStreak(confirmedRiskEvents, selectedStartMs),
		[confirmedRiskEvents, selectedStartMs],
	);

	const prevConfirmedRiskEvents = useMemo(
		() =>
			prevDayEvents
				.filter((e) => !!e.trackedAddiction)
				.sort((a, b) => a.timestamp - b.timestamp),
		[prevDayEvents],
	);

	const prevAddictionStreak = useMemo(
		() => computeAddictionStreak(prevConfirmedRiskEvents, prevStartMs),
		[prevConfirmedRiskEvents, prevStartMs],
	);

	const riskMinutes = useMemo(
		() =>
			countCoveredSlots(confirmedRiskEvents, selectedStartMs) * SLOT_MINUTES,
		[confirmedRiskEvents, selectedStartMs],
	);

	const prevRiskMinutes = useMemo(
		() =>
			countCoveredSlots(prevConfirmedRiskEvents, prevStartMs) * SLOT_MINUTES,
		[prevConfirmedRiskEvents, prevStartMs],
	);

	const journalDays = useMemo(
		() =>
			new Set(
				eodEntries.filter((e) => e.submittedAt !== null).map((e) => e.dayStart),
			),
		[eodEntries],
	);

	const handlePrevDay = () => setSelectedDay((d) => startOfDay(subDays(d, 1)));
	const handleNextDay = () => setSelectedDay((d) => startOfDay(addDays(d, 1)));
	const handleToday = () => setSelectedDay(startOfDay(new Date()));

	const handleSelectDay = (d: Date) => setSelectedDay(startOfDay(d));

	const handleCreateAddiction = async (data: {
		content: string;
		description?: string | null;
	}) => {
		await createMemory("addiction", data.content, data.description);
		setAddAddictionDialogOpen(false);
	};

	const titleDate = useMemo(
		() => format(selectedDay, "EEE, MMM d"),
		[selectedDay],
	);
	const titleYear = useMemo(() => format(selectedDay, "yyyy"), [selectedDay]);
	const journalMeta = useMemo(() => {
		if (!currentEodEntry || !currentEodEntry.submittedAt)
			return "not submitted";
		return `submitted · ${format(new Date(currentEodEntry.submittedAt), "HH:mm")}`;
	}, [currentEodEntry]);

	const journalContent = useMemo((): EodContentV2 | null => {
		if (!currentEodEntry || !currentEodEntry.submittedAt) return null;
		return migrateContentToV2(currentEodEntry.content);
	}, [currentEodEntry]);

	return (
		<div className="h-full flex flex-col">
			<StoryViewHeader
				scope={scope}
				onScopeChange={setScope}
				onPrevDay={handlePrevDay}
				onNextDay={handleNextDay}
				onToday={handleToday}
				onOpenEod={() => openEod(selectedStartMs)}
				isToday={isToday}
				nextDisabled={selectedStartMs >= todayStartMs}
			/>

			<ScrollArea className="flex-1 h-full">
				<div className="p-6 grid grid-cols-1 lg:grid-cols-[minmax(240px,280px),minmax(0,1fr)] gap-6">
					<StoryViewSidebar
						showJournal={showJournal}
						showAddiction={showAddiction}
						selectedDay={selectedDay}
						onSelectDay={handleSelectDay}
						calendarWeeks={CALENDAR_WEEKS}
						dayCounts={dayCounts}
						maxDayCount={maxDayCount}
						journalDays={journalDays}
						riskDayCounts={riskDayCounts}
						maxRiskDayCount={maxRiskDayCount}
						topApps={topApps}
						topSites={topSites}
						topProjects={topProjects}
						addictions={addictions}
						onAddAddiction={() => setAddAddictionDialogOpen(true)}
						onEditMemory={editMemory}
						onDeleteMemory={deleteMemory}
					/>

					<StoryViewMain
						showJournal={showJournal}
						showAddiction={showAddiction}
						titleDate={titleDate}
						titleYear={titleYear}
						slots={slots}
						daylineMode={daylineMode}
						onDaylineModeChange={setDaylineMode}
						dayStats={dayStats}
						dayEvents={dayEvents}
						prevDayEvents={prevDayEvents}
						activeMinutes={activeMinutes}
						activeSlotCount={activeSlotCount}
						prevActiveMinutes={prevActiveMinutes}
						focusPct={focusPct}
						prevFocusPct={prevFocusPct}
						longestStreakMinutes={longestStreakMinutes}
						prevLongestStreakMinutes={prevLongestStreakMinutes}
						firstSeen={firstSeen}
						lastSeen={lastSeen}
						peakHour={peakHour}
						uniqueApps={uniqueApps}
						uniqueSites={uniqueSites}
						progressProjects={progressProjects}
						progressProject={progressProject}
						onProgressProjectChange={setProgressProject}
						progressAllValue={PROGRESS_ALL}
						filteredProgressEvents={filteredProgressEvents}
						showProgressProject={showProgressProject}
						addictionStreak={addictionStreak}
						prevAddictionStreak={prevAddictionStreak}
						riskMinutes={riskMinutes}
						prevRiskMinutes={prevRiskMinutes}
						firstRiskSeen={firstRiskSeen}
						lastRiskSeen={lastRiskSeen}
						confirmedRiskCount={confirmedRiskEvents.length}
						prevConfirmedRiskCount={prevConfirmedRiskEvents.length}
						dominantAddiction={dominantAddiction}
						topRiskAddictions={topRiskAddictions}
						topRiskSources={topRiskSources}
						journalMeta={journalMeta}
						journalContent={journalContent}
						onOpenEod={() => openEod(selectedStartMs)}
						episodesMeta={episodesMeta}
						episodesTotalEvents={dayRiskEvents.length}
						episodesPage={episodesPageClamped}
						episodesTotalPages={episodesTotalPages}
						onEpisodesPrevPage={() =>
							setEpisodesPage((p) => Math.max(0, p - 1))
						}
						onEpisodesNextPage={() =>
							setEpisodesPage((p) => Math.min(episodesTotalPages - 1, p + 1))
						}
						episodesPageEvents={episodesPageEvents}
					/>
				</div>
			</ScrollArea>

			<AddMemoryDialog
				open={addAddictionDialogOpen}
				onOpenChange={setAddAddictionDialogOpen}
				type="addiction"
				onSubmit={handleCreateAddiction}
			/>
		</div>
	);
}
