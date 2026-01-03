import { format } from "date-fns";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Loader2,
	Pencil,
	Plus,
	Sparkles,
	X,
} from "lucide-react";
import { MemoryCard } from "@/components/memory/MemoryCard";
import { ProgressCard } from "@/components/progress/ProgressCard";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ContributionCalendar } from "@/components/wrapped/ContributionCalendar";
import { CountList } from "@/components/wrapped/CountList";
import { Metric } from "@/components/wrapped/Metric";
import { Panel } from "@/components/wrapped/Panel";
import { DOT_ALPHA_BY_LEVEL, rgba } from "@/lib/color";
import {
	CATEGORY_RGB,
	type DaylineSlot,
	SLOTS_PER_HOUR,
	slotBackgroundColor,
	slotLevel,
	toCategory,
} from "@/lib/dayline";
import { cn } from "@/lib/utils";
import type { Event, Memory, Story } from "@/types";
import {
	type AddictionStreak,
	type CategoryStat,
	deltaTone,
	formatMinutesCompact,
	formatMinutesDelta,
	formatSignedInt,
	invertedDeltaTone,
	type JournalScope,
	riskRule,
	riskSource,
} from "./StoryView.utils";

const DOT_BAR_DOTS = 100;
const DOT_BAR_ALPHA = 0.46 as const;

const RISK_CALENDAR_LEVELS = [
	"bg-muted/50",
	"bg-destructive/15",
	"bg-destructive/25",
	"bg-destructive/40",
	"bg-destructive/60",
] as const;

function allocateDots(
	stats: CategoryStat[],
	totalDots: number,
): Array<{
	category: ReturnType<typeof toCategory>;
	count: number;
	dots: number;
}> {
	const rows = stats
		.filter((s) => s.count > 0)
		.map((s) => ({ category: toCategory(s.category), count: s.count }))
		.sort((a, b) => b.count - a.count);

	const total = rows.reduce((sum, r) => sum + r.count, 0);
	if (total <= 0) return [];

	const exact = rows.map((r) => ({
		...r,
		exact: (r.count / total) * totalDots,
	}));

	const base = exact.map((r) => ({
		...r,
		dots: Math.floor(r.exact),
		remainder: r.exact - Math.floor(r.exact),
	}));

	let remaining = totalDots - base.reduce((sum, r) => sum + r.dots, 0);

	base
		.sort((a, b) => b.remainder - a.remainder)
		.forEach((r) => {
			if (remaining <= 0) return;
			r.dots += 1;
			remaining -= 1;
		});

	return base
		.sort((a, b) => b.count - a.count)
		.map(({ category, count, dots }) => ({ category, count, dots }));
}

function Dayline({
	slots,
	className,
}: {
	slots: DaylineSlot[];
	className?: string;
}) {
	const slices = [0, 1, 2, 3, 4, 5] as const;
	const hours = Array.from({ length: 24 }, (_, h) => h);

	return (
		<div className={cn("overflow-x-auto", className)}>
			<div className="inline-block align-top">
				<div className="relative w-max">
					<div className="absolute -top-6 left-0 font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
						N
					</div>
					<div className="absolute -top-6 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
						D
					</div>
					<div className="grid grid-rows-6 gap-1.5 md:gap-2">
						{slices.map((s) => (
							<div
								key={s}
								className={cn(
									"inline-grid grid-cols-[repeat(24,10px)] gap-1.5",
									"lg:grid-cols-[repeat(24,12px)] lg:gap-2",
									"2xl:grid-cols-[repeat(24,14px)] 2xl:gap-2.5",
								)}
							>
								{hours.map((h) => {
									const idx = h * SLOTS_PER_HOUR + s;
									const slot = slots[idx];
									const level = slotLevel(slot.count);
									const bg = slotBackgroundColor(slot, level);
									const style = bg ? { backgroundColor: bg } : undefined;

									const time = format(new Date(slot.startMs), "HH:mm");
									const label =
										slot.count > 0
											? `${time} · ${slot.count} captures · ${slot.addiction ? `Addiction: ${slot.addiction}` : slot.category}`
											: `${time} · 0 captures`;

									return (
										<div
											key={idx}
											title={label}
											style={style}
											className={cn(
												"bg-muted/50 h-2.5 w-2.5 rounded-[3px]",
												"lg:h-3 lg:w-3 lg:rounded-[4px]",
												"2xl:h-3.5 2xl:w-3.5 2xl:rounded-[4px]",
											)}
										/>
									);
								})}
							</div>
						))}
					</div>
					<div className="mt-3 flex justify-between font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
						<span>00</span>
						<span>06</span>
						<span>12</span>
						<span>18</span>
						<span>24</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function DayWrappedLegend() {
	const alpha = DOT_ALPHA_BY_LEVEL[4];
	const legend = [
		{ label: "Addiction", color: `hsl(var(--destructive) / ${alpha})` },
		{ label: "Study", color: rgba(CATEGORY_RGB.Study, alpha) },
		{ label: "Work", color: rgba(CATEGORY_RGB.Work, alpha) },
		{ label: "Leisure", color: rgba(CATEGORY_RGB.Leisure, alpha) },
		{ label: "Chores", color: rgba(CATEGORY_RGB.Chores, alpha) },
		{ label: "Social", color: rgba(CATEGORY_RGB.Social, alpha) },
		{ label: "Unknown", color: rgba(CATEGORY_RGB.Unknown, alpha) },
	] as const;

	const intensity = [1, 2, 3, 4] as const;

	return (
		<div className="mt-5 flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span className="font-mono text-[10px] tracking-[0.18em]">
						INTENSITY
					</span>
					<div className="flex items-center gap-1">
						{intensity.map((l) => (
							<span
								key={l}
								className="h-2.5 w-2.5 rounded-[3px] bg-muted/20"
								style={{
									backgroundColor: rgba(
										CATEGORY_RGB.Work,
										DOT_ALPHA_BY_LEVEL[l],
									),
								}}
							/>
						))}
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
					{legend.map((it) => (
						<div key={it.label} className="flex items-center gap-2">
							<span
								className="h-2.5 w-2.5 rounded-[3px] bg-muted/20"
								style={{ backgroundColor: it.color }}
							/>
							<span>{it.label}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function DotBar({ stats }: { stats: CategoryStat[] }) {
	const total = stats.reduce((sum, s) => sum + s.count, 0);
	const allocation = allocateDots(stats, DOT_BAR_DOTS);

	if (total <= 0) {
		return (
			<div className="text-sm text-muted-foreground">
				No activity for this day.
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-[repeat(33,1fr)] [@media(min-width:1200px)]:grid-cols-[repeat(50,1fr)] w-fit gap-[3px]">
				{allocation.flatMap((row, rowIndex) =>
					Array.from({ length: row.dots }, (_, i) => (
						<div
							key={`${row.category}-${rowIndex}-${i}`}
							className="size-3 rounded-[3px] bg-muted/50"
							style={{
								backgroundColor: rgba(
									CATEGORY_RGB[row.category],
									DOT_BAR_ALPHA,
								),
							}}
							title={`${row.category} · ${row.count}`}
						/>
					)),
				)}
			</div>
			<div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
				{stats
					.filter((s) => s.count > 0)
					.sort((a, b) => b.count - a.count)
					.map((s) => {
						const c = toCategory(s.category);
						const pct = Math.round((s.count / total) * 100);
						return (
							<div
								key={s.category}
								className="flex items-center justify-between gap-3"
							>
								<div className="flex items-center gap-2">
									<span
										className="size-3 rounded-[3px] bg-muted/50"
										style={{
											backgroundColor: rgba(CATEGORY_RGB[c], DOT_BAR_ALPHA),
										}}
									/>
									<span className="text-foreground/90">{c}</span>
								</div>
								<span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
									{pct}%
								</span>
							</div>
						);
					})}
			</div>
		</div>
	);
}

export function StoryViewHeader({
	scope,
	onScopeChange,
	onPrevDay,
	onNextDay,
	onToday,
	onOpenEod,
	isToday,
	nextDisabled,
	showJournal,
	onGenerate,
	generateDisabled,
	isGenerating,
	hasStory,
}: {
	scope: JournalScope;
	onScopeChange: (scope: JournalScope) => void;
	onPrevDay: () => void;
	onNextDay: () => void;
	onToday: () => void;
	onOpenEod: () => void;
	isToday: boolean;
	nextDisabled: boolean;
	showJournal: boolean;
	onGenerate: () => void;
	generateDisabled: boolean;
	isGenerating: boolean;
	hasStory: boolean;
}) {
	return (
		<div className="drag-region flex border-b border-border p-2 px-4 justify-between">
			<div className="flex flex-col">
				<h1 className="text-lg font-semibold">Journal</h1>
				<p className="text-sm text-muted-foreground">
					A minimal daily overview, built from captures.
				</p>
			</div>

			<div className="flex items-center gap-2 no-drag pt-2">
				<Select
					value={scope}
					onValueChange={(v) => onScopeChange(v as JournalScope)}
				>
					<SelectTrigger className="h-8 w-[116px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="journal">Journal</SelectItem>
						<SelectItem value="addiction">Addiction</SelectItem>
					</SelectContent>
				</Select>
				<Button
					variant="outline"
					size="sm"
					className="w-8 px-0"
					onClick={onPrevDay}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onToday}
					disabled={isToday}
				>
					Today
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="w-8 px-0"
					onClick={onNextDay}
					disabled={nextDisabled}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
				<Button size="sm" variant="secondary" onClick={onOpenEod}>
					End of day
				</Button>
				{showJournal ? (
					<Button size="sm" onClick={onGenerate} disabled={generateDisabled}>
						{isGenerating ? (
							<Loader2 className="size-4 animate-spin" />
						) : hasStory ? (
							"Analyze again"
						) : (
							"Analyze this day"
						)}
					</Button>
				) : null}
			</div>
		</div>
	);
}

export function StoryViewSidebar({
	showJournal,
	showAddiction,
	selectedDay,
	onSelectDay,
	calendarWeeks,
	dayCounts,
	maxDayCount,
	journalDays,
	riskDayCounts,
	maxRiskDayCount,
	topApps,
	topSites,
	topProjects,
	addictions,
	onAddAddiction,
	onEditMemory,
	onDeleteMemory,
}: {
	showJournal: boolean;
	showAddiction: boolean;
	selectedDay: Date;
	onSelectDay: (day: Date) => void;
	calendarWeeks: number;
	dayCounts: Map<number, number>;
	maxDayCount: number;
	journalDays: Set<number>;
	riskDayCounts: Map<number, number>;
	maxRiskDayCount: number;
	topApps: Array<{ label: string; count: number }>;
	topSites: Array<{ label: string; count: number }>;
	topProjects: Array<{ label: string; count: number }>;
	addictions: Memory[];
	onAddAddiction: () => void;
	onEditMemory: (
		id: string,
		updates: { content: string; description?: string | null },
	) => Promise<void>;
	onDeleteMemory: (id: string) => Promise<void>;
}) {
	return (
		<div className="min-w-0 space-y-6">
			{showJournal ? (
				<Panel title="Calendar" meta={`${calendarWeeks} weeks · activity`}>
					<ContributionCalendar
						selectedDay={selectedDay}
						onSelectDay={onSelectDay}
						dayCounts={dayCounts}
						maxCount={maxDayCount}
						ringDays={journalDays}
						weeks={calendarWeeks}
					/>
					<div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
						<span className="font-mono text-[10px] tracking-[0.18em]">
							ACTIVITY
						</span>
						<span className="font-mono text-[10px] tracking-[0.18em]">
							JOURNAL = RING
						</span>
					</div>
				</Panel>
			) : null}

			{showAddiction ? (
				<Panel title="Addictions" meta={`${calendarWeeks} weeks · confirmed`}>
					<ContributionCalendar
						selectedDay={selectedDay}
						onSelectDay={onSelectDay}
						dayCounts={riskDayCounts}
						maxCount={maxRiskDayCount}
						weeks={calendarWeeks}
						levelClasses={RISK_CALENDAR_LEVELS}
					/>
					<div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
						<span className="font-mono text-[10px] tracking-[0.18em]">
							INTENSITY
						</span>
						<span className="font-mono text-[10px] tracking-[0.18em]">
							CONFIRMED EVENTS
						</span>
					</div>
				</Panel>
			) : null}

			{showJournal ? (
				<Panel title="Top" meta="By capture count">
					<div className="space-y-3">
						<CountList title="Apps" items={topApps} />
						<CountList title="Sites" items={topSites} />
						<CountList title="Projects" items={topProjects} />
					</div>
				</Panel>
			) : null}

			{showAddiction ? (
				<Panel
					title="Tracked rules"
					meta={`${addictions.length} active`}
					right={
						<Button size="icon" variant="outline" onClick={onAddAddiction}>
							<Plus className="h-4 w-4" />
						</Button>
					}
				>
					{addictions.length === 0 ? (
						<div className="text-sm text-muted-foreground">
							Add strict definitions like “YouTube Shorts after 22:00” to reduce
							false positives.
						</div>
					) : (
						<div className="space-y-3">
							{addictions.map((m) => (
								<MemoryCard
									key={m.id}
									memory={m}
									onEdit={onEditMemory}
									onDelete={onDeleteMemory}
								/>
							))}
						</div>
					)}
				</Panel>
			) : null}
		</div>
	);
}

type PeakHour = { hour: number; count: number } | null;

export function StoryViewMain({
	showJournal,
	showAddiction,
	titleDate,
	titleYear,
	slots,
	dayStats,
	dayEvents,
	prevDayEvents,
	activeMinutes,
	activeSlotCount,
	prevActiveMinutes,
	focusPct,
	prevFocusPct,
	longestStreakMinutes,
	prevLongestStreakMinutes,
	firstSeen,
	lastSeen,
	peakHour,
	uniqueApps,
	uniqueSites,
	progressProjects,
	progressProject,
	onProgressProjectChange,
	progressAllValue,
	filteredProgressEvents,
	showProgressProject,
	addictionStreak,
	prevAddictionStreak,
	riskMinutes,
	prevRiskMinutes,
	firstRiskSeen,
	lastRiskSeen,
	confirmedRiskCount,
	prevConfirmedRiskCount,
	dominantAddiction,
	topRiskAddictions,
	topRiskSources,
	journalMeta,
	currentStory,
	isEditing,
	isSaving,
	draft,
	onDraftChange,
	onStartEdit,
	onStartWrite,
	onCancelEdit,
	onSave,
	onGenerate,
	generateDisabled,
	isGenerating,
	apiKey,
	episodesMeta,
	episodesTotalEvents,
	episodesPage,
	episodesTotalPages,
	onEpisodesPrevPage,
	onEpisodesNextPage,
	episodesPageEvents,
}: {
	showJournal: boolean;
	showAddiction: boolean;
	titleDate: string;
	titleYear: string;
	slots: DaylineSlot[];
	dayStats: CategoryStat[];
	dayEvents: Event[];
	prevDayEvents: Event[];
	activeMinutes: number;
	activeSlotCount: number;
	prevActiveMinutes: number;
	focusPct: number;
	prevFocusPct: number | null;
	longestStreakMinutes: number;
	prevLongestStreakMinutes: number;
	firstSeen: number | null;
	lastSeen: number | null;
	peakHour: PeakHour;
	uniqueApps: number;
	uniqueSites: number;
	progressProjects: string[];
	progressProject: string;
	onProgressProjectChange: (project: string) => void;
	progressAllValue: string;
	filteredProgressEvents: Event[];
	showProgressProject: boolean;
	addictionStreak: AddictionStreak;
	prevAddictionStreak: AddictionStreak;
	riskMinutes: number;
	prevRiskMinutes: number;
	firstRiskSeen: number | null;
	lastRiskSeen: number | null;
	confirmedRiskCount: number;
	prevConfirmedRiskCount: number;
	dominantAddiction: string;
	topRiskAddictions: Array<{ label: string; count: number }>;
	topRiskSources: Array<{ label: string; count: number }>;
	journalMeta: string;
	currentStory: Story | undefined;
	isEditing: boolean;
	isSaving: boolean;
	draft: string;
	onDraftChange: (value: string) => void;
	onStartEdit: () => void;
	onStartWrite: () => void;
	onCancelEdit: () => void;
	onSave: () => void;
	onGenerate: () => void;
	generateDisabled: boolean;
	isGenerating: boolean;
	apiKey: string | null;
	episodesMeta: string;
	episodesTotalEvents: number;
	episodesPage: number;
	episodesTotalPages: number;
	onEpisodesPrevPage: () => void;
	onEpisodesNextPage: () => void;
	episodesPageEvents: Event[];
}) {
	const capturesDeltaValue = dayEvents.length - prevDayEvents.length;
	const capturesDelta =
		prevDayEvents.length > 0 || dayEvents.length > 0
			? formatSignedInt(capturesDeltaValue)
			: undefined;

	const activeDeltaMinutes = activeMinutes - prevActiveMinutes;
	const activeDelta =
		prevActiveMinutes > 0 || activeMinutes > 0
			? formatMinutesDelta(activeDeltaMinutes)
			: undefined;

	const focusDeltaValue =
		prevFocusPct !== null ? focusPct - prevFocusPct : null;
	const focusDelta =
		focusDeltaValue !== null
			? `${formatSignedInt(focusDeltaValue)}p`
			: undefined;
	const focusDeltaTone =
		focusDeltaValue !== null ? deltaTone(focusDeltaValue) : "neutral";

	const streakDeltaMinutes = longestStreakMinutes - prevLongestStreakMinutes;
	const streakDelta =
		prevLongestStreakMinutes > 0 || longestStreakMinutes > 0
			? formatMinutesDelta(streakDeltaMinutes)
			: undefined;

	const addictionStreakDeltaMinutes =
		addictionStreak.minutes - prevAddictionStreak.minutes;
	const addictionStreakDelta =
		prevAddictionStreak.minutes > 0 || addictionStreak.minutes > 0
			? formatMinutesDelta(addictionStreakDeltaMinutes)
			: undefined;

	const riskMinutesDelta = riskMinutes - prevRiskMinutes;
	const riskMinutesDeltaLabel =
		prevRiskMinutes > 0 || riskMinutes > 0
			? formatMinutesDelta(riskMinutesDelta)
			: undefined;

	const confirmedDeltaValue = confirmedRiskCount - prevConfirmedRiskCount;
	const confirmedDelta =
		prevConfirmedRiskCount > 0 || confirmedRiskCount > 0
			? formatSignedInt(confirmedDeltaValue)
			: undefined;

	const journalPanelRight = (
		<div className="flex items-center gap-2">
			{isEditing ? (
				<>
					<Button
						variant="outline"
						size="icon"
						onClick={onCancelEdit}
						disabled={isSaving}
					>
						<X className="h-4 w-4" />
					</Button>
					<Button size="icon" onClick={onSave} disabled={isSaving}>
						<Check className={cn("h-4 w-4", isSaving ? "animate-spin" : "")} />
					</Button>
				</>
			) : (
				<Button
					variant="outline"
					size="icon"
					onClick={currentStory ? onStartEdit : onStartWrite}
				>
					<Pencil className="h-4 w-4" />
				</Button>
			)}
		</div>
	);

	const journalPanelBody = isEditing ? (
		<Textarea
			value={draft}
			onChange={(e) => onDraftChange(e.target.value)}
			placeholder="Write a quick day note…"
			className="min-h-[220px] font-mono text-[12px] leading-relaxed"
		/>
	) : currentStory ? (
		<pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/90">
			{currentStory.content}
		</pre>
	) : (
		<div className="space-y-4">
			<pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-muted-foreground">
				{`DAY WRAPPED
···

AT A GLANCE
- —

HIGHLIGHTS
- —

PATTERNS
- —

TOMORROW
- —`}
			</pre>
			<div className="flex items-center gap-2">
				<Button variant="outline" onClick={onStartWrite}>
					Write manually
				</Button>
				<Button onClick={onGenerate} disabled={generateDisabled}>
					<Sparkles
						className={cn("h-4 w-4 mr-2", isGenerating ? "animate-spin" : "")}
					/>
					Generate
				</Button>
				{!apiKey ? (
					<span className="text-xs text-muted-foreground">
						Add an API key in Settings to generate.
					</span>
				) : null}
			</div>
		</div>
	);

	const episodesPagerVisible =
		episodesTotalEvents > 0 && episodesTotalPages > 1;
	const episodesPrevDisabled = episodesPage <= 0;
	const episodesNextDisabled = episodesPage >= episodesTotalPages - 1;

	const episodesPanelRight = episodesPagerVisible ? (
		<div className="flex items-center gap-2">
			<Button
				type="button"
				size="icon"
				variant="outline"
				aria-label="Previous episodes page"
				onClick={onEpisodesPrevPage}
				disabled={episodesPrevDisabled}
			>
				<ChevronLeft className="h-4 w-4" />
			</Button>
			<div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
				{episodesPage + 1} / {episodesTotalPages}
			</div>
			<Button
				type="button"
				size="icon"
				variant="outline"
				aria-label="Next episodes page"
				onClick={onEpisodesNextPage}
				disabled={episodesNextDisabled}
			>
				<ChevronRight className="h-4 w-4" />
			</Button>
		</div>
	) : null;

	const episodesPanelBody =
		episodesTotalEvents === 0 ? (
			<div className="text-sm text-muted-foreground">
				No addiction signals for this day.
			</div>
		) : (
			<div className="space-y-2">
				{episodesPageEvents.map((e) => {
					const rule = riskRule(e);
					const caption = e.caption ?? "—";
					const source = riskSource(e);
					const confidence =
						e.addictionConfidence !== null
							? Math.round(e.addictionConfidence * 100)
							: null;

					return (
						<div
							key={e.id}
							className="rounded-lg border border-border bg-background/30 px-4 py-3"
						>
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0 flex items-center gap-3">
									<span className="shrink-0 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
										{format(new Date(e.timestamp), "HH:mm")}
									</span>
									<span className="inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
										<span className="h-1.5 w-1.5 rounded-full bg-destructive" />
										Confirmed
									</span>
									<span
										className="min-w-0 truncate text-sm text-foreground/90"
										title={rule ?? undefined}
									>
										{rule ?? "—"}
									</span>
								</div>
								<span className="shrink-0 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
									{confidence !== null ? confidence : "—"}
								</span>
							</div>
							<div className="mt-2 min-w-0">
								<div className="flex items-baseline justify-between gap-3">
									<span
										className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
										title={caption}
									>
										{caption}
									</span>
									<span
										className="shrink-0 font-mono text-[11px] tracking-[0.18em] text-muted-foreground"
										title={source ?? undefined}
									>
										{source ?? "—"}
									</span>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		);

	return (
		<div className="min-w-0 space-y-6">
			{showJournal ? (
				<Panel title="Day Wrapped" meta={`${titleDate} · ${titleYear}`}>
					<Dayline slots={slots} />
					<DayWrappedLegend />
				</Panel>
			) : null}

			{showJournal ? (
				<Panel title="Breakdown">
					<DotBar stats={dayStats} />
				</Panel>
			) : null}

			{showJournal ? (
				<Panel title="At a glance" meta="computed from captures">
					<div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
						<Metric
							label="Captures"
							value={String(dayEvents.length)}
							delta={capturesDelta}
							deltaTone={deltaTone(capturesDeltaValue)}
						/>
						<Metric
							label="Active"
							value={`${Math.round(activeMinutes / 60)}h`}
							detail={`${activeMinutes} minutes · ${activeSlotCount} slots`}
							delta={activeDelta}
							deltaTone={deltaTone(activeDeltaMinutes)}
						/>
						<Metric
							label="Focus"
							value={`${focusPct}%`}
							detail="Work + Study"
							delta={focusDelta}
							deltaTone={focusDeltaTone}
						/>
						<Metric
							label="Longest streak"
							value={`${Math.round(longestStreakMinutes / 60)}h`}
							detail={`${longestStreakMinutes} minutes`}
							delta={streakDelta}
							deltaTone={deltaTone(streakDeltaMinutes)}
						/>
					</div>
					<div className="mt-3 text-xs text-muted-foreground">
						<span className="font-mono text-[11px] tracking-[0.18em]">
							WINDOW
						</span>
						<span className="ml-2">
							{firstSeen ? format(new Date(firstSeen), "HH:mm") : "—"} →{" "}
							{lastSeen ? format(new Date(lastSeen), "HH:mm") : "—"}
						</span>
						<span className="ml-4 font-mono text-[11px] tracking-[0.18em]">
							PEAK
						</span>
						<span className="ml-2">
							{peakHour
								? `${String(peakHour.hour).padStart(2, "0")}:00 · ${peakHour.count}`
								: "—"}
						</span>
						<span className="ml-4 font-mono text-[11px] tracking-[0.18em]">
							APPS
						</span>
						<span className="ml-2">{uniqueApps || "—"}</span>
						<span className="ml-4 font-mono text-[11px] tracking-[0.18em]">
							SITES
						</span>
						<span className="ml-2">{uniqueSites || "—"}</span>
					</div>
				</Panel>
			) : null}

			{showJournal ? (
				<Panel
					title="Project progress"
					meta={`${filteredProgressEvents.length} events`}
					right={
						progressProjects.length > 1 ? (
							<Select
								value={progressProject}
								onValueChange={onProgressProjectChange}
							>
								<SelectTrigger className="h-8 w-[160px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={progressAllValue}>All projects</SelectItem>
									{progressProjects.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : null
					}
				>
					{filteredProgressEvents.length === 0 ? (
						<div className="text-sm text-muted-foreground">
							No visual progress screenshots detected for this day.
						</div>
					) : (
						<div className="space-y-3">
							<div className="space-y-6">
								{filteredProgressEvents.slice(0, 3).map((event, index, arr) => (
									<ProgressCard
										key={event.id}
										event={event}
										showProject={showProgressProject}
										isLast={index === arr.length - 1}
									/>
								))}
							</div>
							{filteredProgressEvents.length > 3 ? (
								<div className="text-xs text-muted-foreground">
									Showing first 3 progress events.
								</div>
							) : null}
						</div>
					)}
				</Panel>
			) : null}

			{showAddiction ? (
				<Panel title="Addiction" meta="signals for this day">
					<div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
						<Metric
							label="Streak"
							value={formatMinutesCompact(addictionStreak.minutes)}
							detail={addictionStreak.addiction ?? "—"}
							delta={addictionStreakDelta}
							deltaTone={invertedDeltaTone(addictionStreakDeltaMinutes)}
						/>
						<Metric
							label="Time"
							value={formatMinutesCompact(riskMinutes)}
							detail={
								firstRiskSeen
									? `${format(new Date(firstRiskSeen), "HH:mm")}–${format(new Date(lastRiskSeen ?? firstRiskSeen), "HH:mm")}`
									: undefined
							}
							delta={riskMinutesDeltaLabel}
							deltaTone={invertedDeltaTone(riskMinutesDelta)}
						/>
						<Metric
							label="Confirmed"
							value={String(confirmedRiskCount)}
							delta={confirmedDelta}
							deltaTone={invertedDeltaTone(confirmedDeltaValue)}
						/>
						<Metric label="Dominant" value={dominantAddiction} />
					</div>
					<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
						<CountList title="Addictions" items={topRiskAddictions} />
						<CountList title="Sources" items={topRiskSources} />
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
						<span className="font-mono text-[10px] tracking-[0.18em]">
							SIGNAL
						</span>
						<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/30 px-3 py-1">
							<span className="h-2.5 w-2.5 rounded-[3px] bg-destructive/60" />
							Confirmed
						</span>
					</div>
				</Panel>
			) : null}

			{showJournal ? (
				<Panel title="Journal" meta={journalMeta} right={journalPanelRight}>
					{journalPanelBody}
				</Panel>
			) : null}

			{showAddiction ? (
				<Panel title="Episodes" meta={episodesMeta} right={episodesPanelRight}>
					{episodesPanelBody}
				</Panel>
			) : null}
		</div>
	);
}
