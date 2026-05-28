import { endOfDay, startOfDay, subDays } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { topCounts } from "@/components/story/StoryView.utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CountItem } from "@/components/wrapped/CountList";
import {
	computeDaylineSlots,
	countCoveredSlots,
	SLOT_MINUTES,
} from "@/lib/dayline";
import { useAppStore } from "@/stores/app";
import type { EodContentV2, EodEntryInput, EodSection, Event } from "@/types";
import {
	BottomActions,
	GhostButton,
	PrimaryButton,
	TRANSITION_EASE,
} from "./EndOfDayFlow.primitives";
import {
	buildDefaultContent,
	createEventBlock,
	createTextBlock,
	dayStartMsOf,
	getSectionText,
	insertBlockAfter,
	migrateContentToV2,
	normalizeTitle,
	type Step,
	setSectionText,
	upsertSection,
} from "./EndOfDayFlow.utils";
import { EventPickerDialog } from "./EventPickerDialog";
import { AddictionsStep, ProgressStep, SummaryStep, WriteStep } from "./steps";

export function EndOfDayFlow() {
	const eodOpen = useAppStore((s) => s.eodOpen);
	const eodDayStart = useAppStore((s) => s.eodDayStart);
	const closeEod = useAppStore((s) => s.closeEod);
	const settings = useAppStore((s) => s.settings);

	const [step, setStep] = useState<Step>("summary");
	const [events, setEvents] = useState<Event[]>([]);
	const [prevEvents, setPrevEvents] = useState<Event[]>([]);
	const [stats, setStats] = useState<
		Array<{ category: string; count: number }>
	>([]);
	const [prevStats, setPrevStats] = useState<
		Array<{ category: string; count: number }>
	>([]);
	const [loading, setLoading] = useState(false);

	const [entryId, setEntryId] = useState<string | null>(null);
	const [createdAt, setCreatedAt] = useState<number | null>(null);
	const [submittedAt, setSubmittedAt] = useState<number | null>(null);
	const [content, setContent] = useState<EodContentV2>(() =>
		buildDefaultContent(),
	);
	const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
		null,
	);
	const [riskSelection, setRiskSelection] = useState<Set<string>>(new Set());
	const [potentialProgressSelection, setPotentialProgressSelection] = useState<
		Set<string>
	>(new Set());

	const [isSaving, setIsSaving] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [shouldAutoGenerate, setShouldAutoGenerate] = useState(false);

	const contentHistoryRef = useRef<EodContentV2[]>([]);
	const historyIndexRef = useRef(-1);
	const isUndoRedoRef = useRef(false);

	const [eventPickerOpen, setEventPickerOpen] = useState(false);
	const [eventPickerSectionId, setEventPickerSectionId] = useState<
		string | null
	>(null);
	const [eventPickerInsertAfterBlockId, setEventPickerInsertAfterBlockId] =
		useState<string | null>(null);
	const [eventPickerFilter, setEventPickerFilter] = useState<
		"all" | "progress" | "risk"
	>("all");

	const dayStartMs = useMemo(() => {
		if (!eodDayStart) return null;
		return dayStartMsOf(eodDayStart);
	}, [eodDayStart]);

	const dayEndMs = useMemo(() => {
		if (!dayStartMs) return null;
		return endOfDay(new Date(dayStartMs)).getTime();
	}, [dayStartMs]);

	const prevDayStartMs = useMemo(() => {
		if (!dayStartMs) return null;
		return startOfDay(subDays(new Date(dayStartMs), 1)).getTime();
	}, [dayStartMs]);

	const load = useCallback(async () => {
		if (!eodOpen || !dayStartMs || !dayEndMs || !prevDayStartMs || !window.api)
			return;

		const prevDayEndOfDayMs = endOfDay(new Date(prevDayStartMs)).getTime();
		const todayStartMs = startOfDay(new Date()).getTime();
		const isToday = dayStartMs === todayStartMs;
		const elapsed = Math.max(0, Math.min(Date.now(), dayEndMs) - dayStartMs);
		const prevDayEndMs = isToday
			? Math.min(prevDayEndOfDayMs, prevDayStartMs + elapsed)
			: prevDayEndOfDayMs;

		setLoading(true);
		try {
			const [
				loadedEvents,
				loadedPrevEvents,
				loadedStats,
				loadedPrevStats,
				existing,
			] = await Promise.all([
				window.api.storage.getEvents({
					startDate: dayStartMs,
					endDate: dayEndMs,
					dismissed: false,
				}),
				window.api.storage.getEvents({
					startDate: prevDayStartMs,
					endDate: prevDayEndMs,
					dismissed: false,
				}),
				window.api.storage.getStats(dayStartMs, dayEndMs),
				window.api.storage.getStats(prevDayStartMs, prevDayEndMs),
				window.api.eod.getEntryByDayStart(dayStartMs),
			]);

			setEvents(loadedEvents);
			setPrevEvents(loadedPrevEvents);
			setStats(loadedStats);
			setPrevStats(loadedPrevStats);

			if (existing) {
				const migratedContent = migrateContentToV2(existing.content);
				setEntryId(existing.id);
				setCreatedAt(existing.createdAt);
				setSubmittedAt(existing.submittedAt);
				setContent(migratedContent);
				setSelectedSectionId(migratedContent.sections[0]?.id ?? null);
				setRiskSelection(new Set());
				setPotentialProgressSelection(new Set());

				const summarySection = migratedContent.sections.find(
					(s) => normalizeTitle(s.title) === "summary",
				);
				const summaryText = summarySection
					? getSectionText(summarySection)
					: "";
				const summaryIsEmpty = !summaryText.trim();
				const prevEventCount = migratedContent.summaryEventCount ?? 0;
				const isOutdated =
					!!summaryText.trim() && loadedEvents.length - prevEventCount > 10;
				setShouldAutoGenerate(summaryIsEmpty || isOutdated);
				return;
			}

			const now = Date.now();
			const base = buildDefaultContent();
			setEntryId(uuid());
			setCreatedAt(now);
			setSubmittedAt(null);
			setContent(base);
			setSelectedSectionId(base.sections[0]?.id ?? null);
			setRiskSelection(new Set());
			setPotentialProgressSelection(new Set());
			setShouldAutoGenerate(true);
		} finally {
			setLoading(false);
		}
	}, [dayEndMs, dayStartMs, eodOpen, prevDayStartMs]);

	useEffect(() => {
		if (!eodOpen) return;
		setStep("summary");
		contentHistoryRef.current = [];
		historyIndexRef.current = -1;
		void load();
	}, [eodOpen, load]);

	useEffect(() => {
		if (!eodOpen) return;
		setSelectedSectionId((current) => {
			if (current && content.sections.some((s) => s.id === current))
				return current;
			return content.sections[0]?.id ?? null;
		});
	}, [content.sections, eodOpen]);

	const canGenerateSummary = useMemo(() => {
		if (!settings.apiKey) return false;
		return events.some((e) => e.caption && e.category);
	}, [events, settings.apiKey]);

	const llmEvents = useMemo(
		() =>
			events
				.filter((e) => e.caption && e.category)
				.map((e) => ({
					caption: e.caption!,
					category: e.category!,
					timestamp: e.timestamp,
					project: e.project,
					projectProgress: e.projectProgress === 1,
				}))
				.sort((a, b) => a.timestamp - b.timestamp),
		[events],
	);

	const slots = useMemo(() => {
		if (!dayStartMs) return [];
		return computeDaylineSlots(events, dayStartMs, {
			showDominantWebsites: settings.showDominantWebsites,
		});
	}, [dayStartMs, events, settings.showDominantWebsites]);

	const activeMinutes = useMemo(() => {
		const active = slots.filter((s) => s.count > 0).length;
		return active * SLOT_MINUTES;
	}, [slots]);

	const prevSlots = useMemo(() => {
		if (!prevDayStartMs) return [];
		return computeDaylineSlots(prevEvents, prevDayStartMs, {
			showDominantWebsites: settings.showDominantWebsites,
		});
	}, [prevDayStartMs, prevEvents, settings.showDominantWebsites]);

	const prevActiveMinutes = useMemo(() => {
		const active = prevSlots.filter((s) => s.count > 0).length;
		return active * SLOT_MINUTES;
	}, [prevSlots]);

	const focusPct = useMemo(() => {
		const total = stats.reduce((sum, s) => sum + s.count, 0);
		const focus = stats
			.filter((s) => s.category === "Work" || s.category === "Study")
			.reduce((sum, s) => sum + s.count, 0);
		if (total <= 0) return 0;
		return Math.round((focus / total) * 100);
	}, [stats]);

	const prevFocusPct = useMemo(() => {
		const total = prevStats.reduce((sum, s) => sum + s.count, 0);
		const focus = prevStats
			.filter((s) => s.category === "Work" || s.category === "Study")
			.reduce((sum, s) => sum + s.count, 0);
		if (total <= 0) return 0;
		return Math.round((focus / total) * 100);
	}, [prevStats]);

	const progressEvents = useMemo(
		() =>
			events
				.filter((e) => e.project && e.projectProgress === 1)
				.sort((a, b) => b.timestamp - a.timestamp),
		[events],
	);

	const potentialProgressEvents = useMemo(
		() =>
			events
				.filter(
					(e) =>
						e.project && e.potentialProgress === 1 && e.projectProgress !== 1,
				)
				.sort((a, b) => b.timestamp - a.timestamp),
		[events],
	);

	const riskEvents = useMemo(
		() => events.filter((e) => !!e.trackedAddiction),
		[events],
	);

	const riskMinutes = useMemo(() => {
		if (!dayStartMs) return 0;
		return countCoveredSlots(riskEvents, dayStartMs) * SLOT_MINUTES;
	}, [dayStartMs, riskEvents]);

	const topRiskAddictions = useMemo<CountItem[]>(
		() =>
			topCounts(
				riskEvents.map((e) => e.trackedAddiction),
				3,
			),
		[riskEvents],
	);

	const topRiskSources = useMemo<CountItem[]>(
		() =>
			topCounts(
				riskEvents.map((e) => e.urlHost ?? e.appName),
				3,
			),
		[riskEvents],
	);

	const dominantAddiction = topRiskAddictions[0]?.label ?? "—";

	const selectedSection = useMemo(() => {
		if (selectedSectionId) {
			return content.sections.find((s) => s.id === selectedSectionId) ?? null;
		}
		return content.sections[0] ?? null;
	}, [content.sections, selectedSectionId]);

	const save = useCallback(
		async (nextSubmittedAt: number | null) => {
			if (!dayStartMs || !dayEndMs || !entryId || createdAt === null) return;
			if (!window.api) return;
			setIsSaving(true);
			try {
				const input: EodEntryInput = {
					id: entryId,
					dayStart: dayStartMs,
					dayEnd: dayEndMs,
					schemaVersion: 2,
					content,
					createdAt,
					updatedAt: Date.now(),
					submittedAt: nextSubmittedAt,
				};
				await window.api.eod.upsertEntry(input);
				setSubmittedAt(nextSubmittedAt);
			} finally {
				setIsSaving(false);
			}
		},
		[content, createdAt, dayEndMs, dayStartMs, entryId],
	);

	useEffect(() => {
		if (!eodOpen) return;
		if (!entryId || createdAt === null) return;
		const handle = setTimeout(() => {
			void save(submittedAt);
		}, 650);
		return () => clearTimeout(handle);
	}, [createdAt, entryId, eodOpen, save, submittedAt]);

	const generateSummary = useCallback(async () => {
		if (!canGenerateSummary) return;
		if (!window.api) return;
		setIsGenerating(true);
		try {
			const text = await window.api.llm.generateStory(llmEvents, "daily");
			const existingSummary = content.sections.find(
				(s) => normalizeTitle(s.title) === "summary",
			);

			if (existingSummary) {
				setContent((prev) => ({
					...prev,
					summaryEventCount: events.length,
					sections: upsertSection(prev.sections, existingSummary.id, (s) =>
						setSectionText(s, text.trim()),
					),
				}));
				setSelectedSectionId(existingSummary.id);
			} else {
				const id = uuid();
				const section: EodSection = {
					id,
					title: "Summary",
					blocks: [createTextBlock(text.trim())],
				};
				setContent((prev) => ({
					...prev,
					summaryEventCount: events.length,
					sections: [section, ...prev.sections],
				}));
				setSelectedSectionId(id);
			}
		} finally {
			setIsGenerating(false);
		}
	}, [canGenerateSummary, content.sections, events.length, llmEvents]);

	useEffect(() => {
		if (!eodOpen || !shouldAutoGenerate || isGenerating || loading) return;
		if (!canGenerateSummary) return;
		setShouldAutoGenerate(false);
		void generateSummary();
	}, [
		canGenerateSummary,
		eodOpen,
		generateSummary,
		isGenerating,
		loading,
		shouldAutoGenerate,
	]);

	const openEventPicker = useCallback(
		(sectionId: string, insertAfterBlockId: string) => {
			setEventPickerSectionId(sectionId);
			setEventPickerInsertAfterBlockId(insertAfterBlockId);
			setEventPickerFilter("all");
			setEventPickerOpen(true);
		},
		[],
	);

	const handleEventPicked = useCallback(
		(eventId: string) => {
			if (!eventPickerSectionId || !eventPickerInsertAfterBlockId) return;
			const newBlock = createEventBlock(eventId);
			setContent((prev) => ({
				...prev,
				sections: upsertSection(prev.sections, eventPickerSectionId, (s) => ({
					...s,
					blocks: insertBlockAfter(
						s.blocks,
						eventPickerInsertAfterBlockId,
						newBlock,
					),
				})),
			}));
			setEventPickerOpen(false);
		},
		[eventPickerSectionId, eventPickerInsertAfterBlockId],
	);

	const addBlankSection = useCallback(() => {
		const id = uuid();
		const section: EodSection = {
			id,
			title: "Section",
			blocks: [createTextBlock()],
		};
		setContent((prev) => ({ ...prev, sections: [...prev.sections, section] }));
		setSelectedSectionId(id);
	}, []);

	const createAddictionsSection = useCallback(() => {
		const ids = Array.from(riskSelection);
		const fallback = riskEvents
			.slice()
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, 6)
			.map((e) => e.id);
		const chosen = ids.length > 0 ? ids : fallback;
		if (chosen.length === 0) return;

		const id = uuid();
		const section: EodSection = {
			id,
			title: "Addictions",
			blocks: [
				createTextBlock(),
				...chosen.map((eventId) => createEventBlock(eventId)),
			],
		};
		setContent((prev) => ({ ...prev, sections: [...prev.sections, section] }));
		setSelectedSectionId(id);
		setStep("write");
	}, [riskEvents, riskSelection]);

	const hasPotentialProgress = potentialProgressEvents.length > 0;

	const nextStep = useCallback(() => {
		setStep((s) => {
			if (s === "summary")
				return hasPotentialProgress ? "progress" : "addictions";
			if (s === "progress") return "addictions";
			if (s === "addictions") return "write";
			return s;
		});
	}, [hasPotentialProgress]);

	const prevStep = useCallback(() => {
		setStep((s) => {
			if (s === "write") return "addictions";
			if (s === "addictions")
				return hasPotentialProgress ? "progress" : "summary";
			if (s === "progress") return "summary";
			return s;
		});
	}, [hasPotentialProgress]);

	const canGoBack = step !== "summary";
	const canGoNext = step !== "write";

	const submit = useCallback(async () => {
		if (potentialProgressSelection.size > 0) {
			await window.api.storage.markProjectProgressBulk(
				Array.from(potentialProgressSelection),
			);
		}
		await save(Date.now());
		closeEod();
	}, [closeEod, potentialProgressSelection, save]);

	useEffect(() => {
		if (!eodOpen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && step === "write") {
				e.preventDefault();
				void submit();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [eodOpen, step, submit]);

	useEffect(() => {
		if (isUndoRedoRef.current) {
			isUndoRedoRef.current = false;
			return;
		}
		const history = contentHistoryRef.current;
		const currentIndex = historyIndexRef.current;

		if (currentIndex < history.length - 1) {
			contentHistoryRef.current = history.slice(0, currentIndex + 1);
		}

		contentHistoryRef.current.push(structuredClone(content));
		if (contentHistoryRef.current.length > 100) {
			contentHistoryRef.current.shift();
		} else {
			historyIndexRef.current = contentHistoryRef.current.length - 1;
		}
	}, [content]);

	const undo = useCallback(() => {
		const history = contentHistoryRef.current;
		const currentIndex = historyIndexRef.current;

		if (currentIndex > 0) {
			isUndoRedoRef.current = true;
			historyIndexRef.current = currentIndex - 1;
			setContent(structuredClone(history[currentIndex - 1]));
		}
	}, []);

	const redo = useCallback(() => {
		const history = contentHistoryRef.current;
		const currentIndex = historyIndexRef.current;

		if (currentIndex < history.length - 1) {
			isUndoRedoRef.current = true;
			historyIndexRef.current = currentIndex + 1;
			setContent(structuredClone(history[currentIndex + 1]));
		}
	}, []);

	useEffect(() => {
		if (!eodOpen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "z") {
				if (e.shiftKey) {
					e.preventDefault();
					redo();
				} else {
					e.preventDefault();
					undo();
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [eodOpen, undo, redo]);

	if (!eodOpen || !dayStartMs || !dayEndMs) return null;

	const togglePotentialProgress = (id: string) => {
		setPotentialProgressSelection((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleRiskSelection = (id: string) => {
		setRiskSelection((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl">
			<div className="h-10 drag-region shrink-0" />

			<div className=" flex-1 overflow-hidden relative">
				<div className="absolute right-6 -top-0 z-10 flex items-center gap-2 no-drag">
					<Button
						variant="ghost"
						size="icon"
						onClick={closeEod}
						className="size-6"
						aria-label="Close end of day"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>

				<ScrollArea className="h-full">
					<div className="relative max-w-5xl mx-auto px-6 py-8 min-h-full pb-28">
						<AnimatePresence mode="wait">
							<motion.div
								key={step}
								initial={{ opacity: 0, filter: "blur(8px)", y: 10 }}
								animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
								exit={{ opacity: 0, filter: "blur(8px)", y: -10 }}
								transition={{ duration: 0.18, ease: TRANSITION_EASE }}
								className="space-y-6"
							>
								{step === "summary" && (
									<SummaryStep
										dayStartMs={dayStartMs}
										events={events}
										slots={slots}
										progressEvents={progressEvents}
										riskEvents={riskEvents}
										loading={loading}
										submittedAt={submittedAt}
										isSaving={isSaving}
										activeMinutes={activeMinutes}
										prevActiveMinutes={prevActiveMinutes}
										focusPct={focusPct}
										prevFocusPct={prevFocusPct}
										riskMinutes={riskMinutes}
										dominantAddiction={dominantAddiction}
									/>
								)}

								{step === "progress" && (
									<ProgressStep
										potentialProgressEvents={potentialProgressEvents}
										progressEvents={progressEvents}
										potentialProgressSelection={potentialProgressSelection}
										onToggleSelection={togglePotentialProgress}
									/>
								)}

								{step === "addictions" && (
									<AddictionsStep
										riskMinutes={riskMinutes}
										riskEvents={riskEvents}
										riskSelection={riskSelection}
										topRiskAddictions={topRiskAddictions}
										topRiskSources={topRiskSources}
										onToggleSelection={toggleRiskSelection}
										onCreateAddictionsSection={createAddictionsSection}
									/>
								)}

								{step === "write" && (
									<WriteStep
										content={content}
										selectedSection={selectedSection}
										events={events}
										onSelectSection={setSelectedSectionId}
										onAddSection={addBlankSection}
										onOpenEventPicker={openEventPicker}
										onUpdateContent={setContent}
									/>
								)}
							</motion.div>
						</AnimatePresence>
					</div>
				</ScrollArea>

				<BottomActions
					left={
						step === "summary" ? (
							<div />
						) : (
							<GhostButton onClick={prevStep} disabled={!canGoBack}>
								<ArrowLeft className="h-3.5 w-3.5" />
							</GhostButton>
						)
					}
					right={
						step === "write" ? (
							<PrimaryButton
								onClick={() => void submit()}
								disabled={isSaving || loading}
								className="h-9 px-4"
							>
								{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
								{submittedAt ? "Update" : "Submit"}
								<ArrowRight className="h-4 w-4" />
							</PrimaryButton>
						) : (
							<PrimaryButton
								onClick={nextStep}
								disabled={loading || !canGoNext}
								className="h-9 px-4"
							>
								Next
								<ArrowRight className="h-4 w-4" />
							</PrimaryButton>
						)
					}
				/>

				<EventPickerDialog
					open={eventPickerOpen}
					onOpenChange={setEventPickerOpen}
					events={events}
					progressEvents={progressEvents}
					riskEvents={riskEvents}
					filter={eventPickerFilter}
					onFilterChange={setEventPickerFilter}
					onSelectEvent={handleEventPicked}
				/>
			</div>
		</div>
	);
}
