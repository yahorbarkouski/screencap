import { endOfDay, format, startOfDay } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
	ArrowLeft,
	ArrowRight,
	Loader2,
	Paperclip,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import {
	deltaTone,
	formatMinutesDelta,
	formatSignedInt,
	topCounts,
} from "@/components/story/StoryView.utils";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { DaylineChart } from "@/components/visualization/DaylineChart";
import { type CountItem, CountList } from "@/components/wrapped/CountList";
import {
	computeDaylineSlots,
	countCoveredSlots,
	SLOT_MINUTES,
} from "@/lib/dayline";
import { cn, formatTime } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type {
	EodAttachment,
	EodContent,
	EodEntryInput,
	EodSection,
	Event,
} from "@/types";

type Step = "summary" | "addictions" | "write" | "review";

const ease = [0.25, 0.1, 0.25, 1] as const;

function FadeIn({
	children,
	delay = 0,
	className = "",
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, filter: "blur(6px)", y: 8 }}
			animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
			exit={{ opacity: 0, filter: "blur(6px)", y: -8 }}
			transition={{ duration: 0.18, ease, delay }}
			className={className}
		>
			{children}
		</motion.div>
	);
}

function PrimaryButton({
	children,
	onClick,
	disabled,
	className = "",
}: {
	children: React.ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<motion.button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
				"border-zinc-800 bg-black/90 text-zinc-200 hover:bg-zinc-950/60 hover:border-yellow-500/40 hover:text-white",
				"disabled:opacity-50 disabled:pointer-events-none",
				className,
			)}
			whileHover={{
				textShadow:
					"0 0 10px rgba(255, 215, 0, 0.55), 0 0 18px rgba(255, 215, 0, 0.25)",
				boxShadow:
					"0 0 0 1px rgba(255, 215, 0, 0.06), 0 0 18px rgba(255, 215, 0, 0.10)",
			}}
			whileTap={{ scale: 0.99 }}
			transition={{ duration: 0.18 }}
		>
			{children}
		</motion.button>
	);
}

function GhostButton({
	children,
	onClick,
	disabled,
	className = "",
}: {
	children: React.ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors",
				"border-zinc-800/50 bg-transparent text-zinc-400 hover:text-white hover:border-zinc-700",
				"disabled:opacity-50 disabled:pointer-events-none",
				className,
			)}
		>
			{children}
		</button>
	);
}

function BottomActions({
	left,
	right,
}: {
	left: React.ReactNode;
	right: React.ReactNode;
}) {
	return (
		<div className="fixed bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
			<div className="pointer-events-auto flex items-center justify-center gap-2">
				{left}
				{right}
			</div>
		</div>
	);
}

function Card({
	title,
	subtitle,
	right,
	children,
	className,
}: {
	title: string;
	subtitle?: string;
	right?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"rounded-xl border border-border bg-muted/20 backdrop-blur-sm",
				className,
			)}
		>
			<div className="p-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
							{title.toUpperCase()}
						</div>
						{subtitle ? (
							<div className="mt-1 text-sm text-foreground/90">{subtitle}</div>
						) : null}
					</div>
					{right}
				</div>
				<div className="mt-4">{children}</div>
			</div>
		</div>
	);
}

function Kpi({
	label,
	value,
	detail,
	delta,
	deltaTone,
}: {
	label: string;
	value: string;
	detail?: string;
	delta?: string;
	deltaTone?: "up" | "down" | "neutral";
}) {
	return (
		<div className="rounded-lg border border-border bg-background/30 px-4 py-3">
			<div className="flex items-center justify-between gap-2">
				<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
					{label.toUpperCase()}
				</div>
				{delta ? (
					<div
						className={cn(
							"font-mono text-[10px] tracking-[0.18em]",
							deltaTone === "up"
								? "text-green-400"
								: deltaTone === "down"
									? "text-red-400"
									: "text-muted-foreground",
						)}
					>
						{delta}
					</div>
				) : null}
			</div>
			<div className="mt-1 text-2xl font-semibold leading-none">{value}</div>
			{detail ? (
				<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
			) : null}
		</div>
	);
}

function Stamp({
	tone,
	title,
	detail,
}: {
	tone: "good" | "warn" | "bad";
	title: string;
	detail: string;
}) {
	const cfg = {
		good: {
			bg: "bg-green-500/10",
			border: "border-green-500/20",
			text: "text-green-400",
			glow: "shadow-[0_0_20px_rgba(34,197,94,0.12)]",
		},
		warn: {
			bg: "bg-amber-500/10",
			border: "border-amber-500/25",
			text: "text-amber-400",
			glow: "shadow-[0_0_20px_rgba(245,158,11,0.12)]",
		},
		bad: {
			bg: "bg-red-500/10",
			border: "border-red-500/25",
			text: "text-red-400",
			glow: "shadow-[0_0_20px_rgba(239,68,68,0.12)]",
		},
	}[tone];

	return (
		<motion.div
			initial={{ scale: 0.97, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 22 }}
			className={cn(
				"rounded-xl border px-4 py-3 backdrop-blur-sm",
				cfg.bg,
				cfg.border,
				cfg.glow,
			)}
		>
			<div className={cn("text-sm font-medium", cfg.text)}>{title}</div>
			<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
		</motion.div>
	);
}

function dayStartMsOf(timestamp: number): number {
	return startOfDay(new Date(timestamp)).getTime();
}

function buildDefaultContent(): EodContent {
	return {
		version: 1,
		sections: [
			{ id: uuid(), title: "Overview", body: "", attachments: [] },
			{ id: uuid(), title: "TILs", body: "", attachments: [] },
		],
	};
}

function formatMinutes(minutes: number): string {
	if (minutes <= 0) return "0m";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h <= 0) return `${m}m`;
	if (m <= 0) return `${h}h`;
	return `${h}h ${m}m`;
}

function normalizeTitle(title: string): string {
	return title.trim().toLowerCase();
}

function upsertSection(
	sections: EodSection[],
	sectionId: string,
	update: (section: EodSection) => EodSection,
): EodSection[] {
	return sections.map((s) => (s.id === sectionId ? update(s) : s));
}

function removeSection(
	sections: EodSection[],
	sectionId: string,
): EodSection[] {
	return sections.filter((s) => s.id !== sectionId);
}

function formatDayTitle(dayStartMs: number): string {
	return format(new Date(dayStartMs), "MMMM d");
}

function primaryImagePath(e: Event): string | null {
	return e.originalPath ?? e.thumbnailPath ?? null;
}

export function EndOfDayFlow() {
	const eodOpen = useAppStore((s) => s.eodOpen);
	const eodDayStart = useAppStore((s) => s.eodDayStart);
	const closeEod = useAppStore((s) => s.closeEod);
	const settings = useAppStore((s) => s.settings);

	const [step, setStep] = useState<Step>("summary");
	const [events, setEvents] = useState<Event[]>([]);
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
	const [content, setContent] = useState<EodContent>(() =>
		buildDefaultContent(),
	);
	const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
		null,
	);
	const [riskSelection, setRiskSelection] = useState<Set<string>>(new Set());

	const [isSaving, setIsSaving] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [shouldAutoGenerate, setShouldAutoGenerate] = useState(false);

	const [attachDialogOpen, setAttachDialogOpen] = useState(false);
	const [attachSectionId, setAttachSectionId] = useState<string | null>(null);
	const [attachSelection, setAttachSelection] = useState<Set<string>>(
		new Set(),
	);
	const [attachFilter, setAttachFilter] = useState<"all" | "progress" | "risk">(
		"all",
	);

	const dayStartMs = useMemo(() => {
		if (!eodDayStart) return null;
		return dayStartMsOf(eodDayStart);
	}, [eodDayStart]);

	const dayEndMs = useMemo(() => {
		if (!dayStartMs) return null;
		return endOfDay(new Date(dayStartMs)).getTime();
	}, [dayStartMs]);

	const load = useCallback(async () => {
		if (!eodOpen || !dayStartMs || !dayEndMs || !window.api) return;

		setLoading(true);
		try {
			const [loadedEvents, loadedStats, loadedPrevStats, existing] =
				await Promise.all([
					window.api.storage.getEvents({
						startDate: dayStartMs,
						endDate: dayEndMs,
						dismissed: false,
					}),
					window.api.storage.getStats(dayStartMs, dayEndMs),
					window.api.storage.getStats(
						dayStartMs - 24 * 60 * 60 * 1000,
						dayEndMs - 24 * 60 * 60 * 1000,
					),
					window.api.eod.getEntryByDayStart(dayStartMs),
				]);

			setEvents(loadedEvents);
			setStats(loadedStats);
			setPrevStats(loadedPrevStats);

			if (existing) {
				setEntryId(existing.id);
				setCreatedAt(existing.createdAt);
				setSubmittedAt(existing.submittedAt);
				setContent(existing.content);
				setSelectedSectionId(existing.content.sections[0]?.id ?? null);
				setRiskSelection(new Set());

				const summarySection = existing.content.sections.find(
					(s) => normalizeTitle(s.title) === "summary",
				);
				const summaryIsEmpty = !summarySection || !summarySection.body.trim();
				const prevEventCount = existing.content.summaryEventCount ?? 0;
				const isOutdated =
					!!summarySection?.body.trim() &&
					loadedEvents.length - prevEventCount > 10;
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
			setShouldAutoGenerate(true);
		} finally {
			setLoading(false);
		}
	}, [dayEndMs, dayStartMs, eodOpen]);

	useEffect(() => {
		if (!eodOpen) return;
		setStep("summary");
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
		return computeDaylineSlots(events, dayStartMs);
	}, [dayStartMs, events]);

	const activeMinutes = useMemo(() => {
		const active = slots.filter((s) => s.count > 0).length;
		return active * SLOT_MINUTES;
	}, [slots]);

	const statsTotalMinutes = useMemo(() => {
		return stats.reduce((acc, s) => acc + s.count, 0) * SLOT_MINUTES;
	}, [stats]);

	const prevStatsTotalMinutes = useMemo(() => {
		return prevStats.reduce((acc, s) => acc + s.count, 0) * SLOT_MINUTES;
	}, [prevStats]);

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

	const activeDelta = statsTotalMinutes - prevStatsTotalMinutes;
	const focusDelta = focusPct - prevFocusPct;

	const uniqueApps = useMemo(
		() => new Set(events.map((e) => e.appName).filter(Boolean)).size,
		[events],
	);

	const topApps = useMemo<CountItem[]>(
		() =>
			topCounts(
				events.map((e) => e.appName),
				3,
			),
		[events],
	);
	const topSites = useMemo<CountItem[]>(
		() =>
			topCounts(
				events.map((e) => e.urlHost),
				3,
			),
		[events],
	);
	const topProjects = useMemo<CountItem[]>(
		() =>
			topCounts(
				events.map((e) => e.project),
				3,
			),
		[events],
	);

	const progressEvents = useMemo(
		() =>
			events
				.filter((e) => e.project && e.projectProgress === 1)
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

	const attachCandidates = useMemo(() => {
		const base =
			attachFilter === "risk"
				? riskEvents
				: attachFilter === "progress"
					? progressEvents
					: events;
		return base.slice().sort((a, b) => b.timestamp - a.timestamp);
	}, [attachFilter, events, progressEvents, riskEvents]);

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
					schemaVersion: 1,
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
		if (submittedAt !== null) return;
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
					sections: upsertSection(prev.sections, existingSummary.id, (s) => ({
						...s,
						body: text.trim(),
					})),
				}));
				setSelectedSectionId(existingSummary.id);
			} else {
				const id = uuid();
				const section: EodSection = {
					id,
					title: "Summary",
					body: text.trim(),
					attachments: [],
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

	const openAttachDialog = useCallback(
		(sectionId: string) => {
			const section = content.sections.find((s) => s.id === sectionId);
			if (!section) return;
			setAttachSectionId(sectionId);
			const selected = new Set(
				section.attachments
					.filter(
						(a): a is Extract<EodAttachment, { kind: "event" }> =>
							a.kind === "event",
					)
					.map((a) => a.eventId),
			);
			setAttachSelection(selected);
			setAttachFilter("all");
			setAttachDialogOpen(true);
		},
		[content.sections],
	);

	const applyAttachments = useCallback(() => {
		if (!attachSectionId) return;
		const attachments: EodAttachment[] = Array.from(attachSelection).map(
			(eventId) => ({ kind: "event", eventId }),
		);
		setContent((prev) => ({
			...prev,
			sections: upsertSection(prev.sections, attachSectionId, (s) => ({
				...s,
				attachments,
			})),
		}));
		setAttachDialogOpen(false);
	}, [attachSectionId, attachSelection]);

	const removeAttachment = useCallback((sectionId: string, eventId: string) => {
		setContent((prev) => ({
			...prev,
			sections: upsertSection(prev.sections, sectionId, (s) => ({
				...s,
				attachments: s.attachments.filter(
					(a) => !(a.kind === "event" && a.eventId === eventId),
				),
			})),
		}));
	}, []);

	const addBlankSection = useCallback(() => {
		const id = uuid();
		const section: EodSection = {
			id,
			title: "Section",
			body: "",
			attachments: [],
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
		const attachments: EodAttachment[] = chosen.map((eventId) => ({
			kind: "event",
			eventId,
		}));
		const section: EodSection = {
			id,
			title: "Addictions",
			body: "",
			attachments,
		};
		setContent((prev) => ({ ...prev, sections: [...prev.sections, section] }));
		setSelectedSectionId(id);
		setStep("write");
	}, [riskEvents, riskSelection]);

	const stepIndex = useMemo(() => {
		const steps: Step[] = ["summary", "addictions", "write", "review"];
		return steps.indexOf(step) + 1;
	}, [step]);

	const stepTotal = 4;

	const nextStep = useCallback(() => {
		setStep((s) => {
			if (s === "summary") return "addictions";
			if (s === "addictions") return "write";
			if (s === "write") return "review";
			return s;
		});
	}, []);

	const prevStep = useCallback(() => {
		setStep((s) => {
			if (s === "review") return "write";
			if (s === "write") return "addictions";
			if (s === "addictions") return "summary";
			return s;
		});
	}, []);

	const canGoBack = step !== "summary";
	const canGoNext = step !== "review";

	const submit = useCallback(async () => {
		await save(Date.now());
		closeEod();
	}, [closeEod, save]);

	useEffect(() => {
		if (!eodOpen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				closeEod();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && step === "review") {
				e.preventDefault();
				void submit();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [closeEod, eodOpen, step, submit]);

	if (!eodOpen || !dayStartMs || !dayEndMs) return null;

	const firstSeen = (() => {
		let min = Number.POSITIVE_INFINITY;
		for (const e of events) {
			if (e.timestamp < min) min = e.timestamp;
		}
		return Number.isFinite(min) ? min : null;
	})();

	const lastSeen = (() => {
		let max = Number.NEGATIVE_INFINITY;
		for (const e of events) {
			const end = e.endTimestamp ?? e.timestamp;
			if (end > max) max = end;
		}
		return Number.isFinite(max) ? max : null;
	})();

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl">
			<div className="h-10 drag-region shrink-0" />

			<div className="relative flex-1 overflow-hidden">
				<ScrollArea className="h-full">
					<div className="relative max-w-5xl mx-auto px-6 py-8 min-h-full pb-28">
						<div className="absolute right-6 top-6 z-10 flex items-center gap-2 no-drag">
							<div className="hidden sm:block font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
								{stepIndex}/{stepTotal}
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={closeEod}
								aria-label="Close end of day"
							>
								<X className="h-4 w-4" />
							</Button>
						</div>

						<FadeIn delay={0}>
							<div className="flex flex-col items-center justify-center space-y-2 mb-8">
								<div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.28em] text-muted-foreground uppercase">
									<span>End of day</span>
									<span>·</span>
									<span className={submittedAt ? "text-green-500" : ""}>
										{submittedAt
											? "Submitted"
											: isSaving
												? "Saving..."
												: "Draft"}
									</span>
								</div>
								<div className="text-4xl font-bold tracking-tight">
									{formatDayTitle(dayStartMs)}
								</div>
								<div className="text-sm text-muted-foreground">
									{loading
										? "Loading…"
										: `${events.length} events · ${progressEvents.length} progress · ${riskEvents.length} risk`}
									{firstSeen && lastSeen ? (
										<span className="ml-2 text-muted-foreground/70">
											· {formatTime(firstSeen)}–{formatTime(lastSeen)}
										</span>
									) : null}
								</div>
							</div>
						</FadeIn>

						<AnimatePresence mode="wait">
							<motion.div
								key={step}
								initial={{ opacity: 0, filter: "blur(8px)", y: 10 }}
								animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
								exit={{ opacity: 0, filter: "blur(8px)", y: -10 }}
								transition={{ duration: 0.18, ease }}
								className="space-y-6"
							>
								{step === "summary" ? (
									<>
										<FadeIn delay={0.02}>
											<Card title="Activity" className="bg-muted/10 border-0">
												<div className="pt-2 pb-4">
													<DaylineChart slots={slots} />
												</div>
											</Card>
										</FadeIn>

										<FadeIn delay={0.04}>
											<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
												<Kpi
													label="Active"
													value={formatMinutes(activeMinutes)}
													delta={formatMinutesDelta(activeDelta)}
													deltaTone={deltaTone(activeDelta)}
												/>
												<Kpi
													label="Focus"
													value={`${focusPct}%`}
													delta={`${formatSignedInt(focusDelta)}%`}
													deltaTone={deltaTone(focusDelta)}
												/>
												<Kpi label="Unique apps" value={String(uniqueApps)} />
												<Kpi
													label="Risk"
													value={formatMinutes(riskMinutes)}
													detail={
														dominantAddiction === "—"
															? undefined
															: dominantAddiction
													}
													delta={riskMinutes > 0 ? "Detected" : undefined}
													deltaTone={riskMinutes > 0 ? "down" : "neutral"}
												/>
											</div>
										</FadeIn>

										<FadeIn delay={0.06}>
											<Card title="Breakdown">
												<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
													<CountList title="Top apps" items={topApps} />
													<CountList title="Top sites" items={topSites} />
													<CountList title="Top projects" items={topProjects} />
												</div>
											</Card>
										</FadeIn>
									</>
								) : step === "addictions" ? (
									<>
										<FadeIn delay={0.02}>
											<div className="text-center space-y-2 mb-6">
												<h1 className="text-2xl font-bold">
													Addictions check-in
												</h1>
											</div>
										</FadeIn>

										<FadeIn delay={0.04}>
											{riskMinutes === 0 ? (
												<Stamp
													tone="good"
													title="Clean day"
													detail="No addiction incidents detected."
												/>
											) : riskMinutes < 30 ? (
												<Stamp
													tone="warn"
													title="Some risk"
													detail={`${formatMinutes(riskMinutes)} of risk time detected.`}
												/>
											) : (
												<Stamp
													tone="bad"
													title="High risk"
													detail={`${formatMinutes(riskMinutes)} of risk time detected.`}
												/>
											)}
										</FadeIn>

										<FadeIn delay={0.06}>
											<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
												<CountList
													title="Top addictions"
													items={topRiskAddictions}
												/>
												<CountList title="Top sources" items={topRiskSources} />
											</div>
										</FadeIn>

										{riskEvents.length > 0 ? (
											<FadeIn delay={0.08} className="mt-6">
												<div className="flex items-center justify-between">
													<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
														EPISODES
													</div>
													<Button
														size="sm"
														variant="secondary"
														onClick={createAddictionsSection}
													>
														Review in Journal
														<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
													</Button>
												</div>
												<div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
													{riskEvents
														.slice()
														.sort((a, b) => b.timestamp - a.timestamp)
														.slice(0, 8)
														.map((e) => {
															const img = primaryImagePath(e);
															const selected = riskSelection.has(e.id);
															return (
																<button
																	key={e.id}
																	type="button"
																	className={cn(
																		"rounded-lg border overflow-hidden text-left bg-background/30 transition-colors relative group",
																		selected
																			? "border-primary ring-1 ring-primary"
																			: "border-border hover:border-primary/40",
																	)}
																	onClick={() => {
																		setRiskSelection((prev) => {
																			const next = new Set(prev);
																			if (next.has(e.id)) next.delete(e.id);
																			else next.add(e.id);
																			return next;
																		});
																	}}
																>
																	<div className="aspect-video bg-muted/30 flex items-center justify-center">
																		{img ? (
																			<img
																				alt=""
																				src={`local-file://${img}`}
																				className="w-full h-full object-cover"
																				loading="lazy"
																			/>
																		) : null}
																	</div>
																	<div className="p-2">
																		<div className="text-[10px] text-muted-foreground">
																			{formatTime(e.timestamp)}
																		</div>
																		<div className="truncate text-xs font-medium">
																			{e.trackedAddiction}
																		</div>
																	</div>
																	{selected && (
																		<div className="absolute top-1 right-1 h-4 w-4 bg-primary rounded-full flex items-center justify-center shadow-sm">
																			<div className="h-1.5 w-1.5 bg-primary-foreground rounded-full" />
																		</div>
																	)}
																</button>
															);
														})}
												</div>
											</FadeIn>
										) : null}
									</>
								) : step === "write" ? (
									<>
										<FadeIn delay={0.02}>
											<div className="flex items-center justify-between mb-4">
												<h1 className="text-2xl font-bold">Write</h1>
												<Button
													variant="outline"
													size="sm"
													onClick={() => void generateSummary()}
													disabled={!canGenerateSummary || isGenerating}
												>
													{isGenerating ? (
														<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
													) : null}
													Generate Summary
												</Button>
											</div>
										</FadeIn>

										<FadeIn delay={0.04}>
											<div className="grid grid-cols-1 lg:grid-cols-[240px,minmax(0,1fr)] gap-6 h-[500px]">
												<div className="flex flex-col gap-2">
													<div className="space-y-1">
														{content.sections.map((s) => {
															const isSelected = selectedSection?.id === s.id;
															return (
																<button
																	key={s.id}
																	type="button"
																	onClick={() => setSelectedSectionId(s.id)}
																	className={cn(
																		"w-full text-left rounded-lg px-3 py-2 transition-colors text-sm font-medium",
																		isSelected
																			? "bg-secondary text-secondary-foreground"
																			: "hover:bg-muted/50 text-muted-foreground hover:text-foreground",
																	)}
																>
																	<div className="truncate">
																		{s.title.trim() ? s.title : "Untitled"}
																	</div>
																</button>
															);
														})}
													</div>
													<Button
														variant="ghost"
														size="sm"
														className="justify-start px-3 text-muted-foreground"
														onClick={addBlankSection}
													>
														<Plus className="mr-2 h-3.5 w-3.5" />
														Add section
													</Button>
												</div>

												<div className="flex flex-col h-full bg-muted/10 rounded-xl border border-border/50 overflow-hidden">
													{selectedSection ? (
														<div className="flex flex-col h-full">
															<div className="flex items-center gap-2 p-3 border-b border-border/50">
																<Input
																	value={selectedSection.title}
																	onChange={(e) => {
																		const nextTitle = e.target.value;
																		setContent((prev) => ({
																			...prev,
																			sections: upsertSection(
																				prev.sections,
																				selectedSection.id,
																				(s) => ({ ...s, title: nextTitle }),
																			),
																		}));
																	}}
																	className="h-9 border-none bg-transparent shadow-none font-semibold text-lg px-2 focus-visible:ring-0"
																	placeholder="Section title"
																/>
																<div className="flex items-center gap-1">
																	<Button
																		variant="ghost"
																		size="icon"
																		onClick={() =>
																			openAttachDialog(selectedSection.id)
																		}
																		className="h-8 w-8 text-muted-foreground"
																	>
																		<Paperclip className="h-4 w-4" />
																	</Button>
																	<Button
																		variant="ghost"
																		size="icon"
																		onClick={() => {
																			setContent((prev) => ({
																				...prev,
																				sections: removeSection(
																					prev.sections,
																					selectedSection.id,
																				),
																			}));
																		}}
																		disabled={content.sections.length <= 1}
																		className="h-8 w-8 text-muted-foreground hover:text-destructive"
																	>
																		<Trash2 className="h-4 w-4" />
																	</Button>
																</div>
															</div>
															<Textarea
																value={selectedSection.body}
																onChange={(e) => {
																	const nextBody = e.target.value;
																	setContent((prev) => ({
																		...prev,
																		sections: upsertSection(
																			prev.sections,
																			selectedSection.id,
																			(s) => ({ ...s, body: nextBody }),
																		),
																	}));
																}}
																placeholder="Write something..."
																className="flex-1 resize-none border-none bg-transparent shadow-none p-4 focus-visible:ring-0 text-base leading-relaxed"
															/>
															{selectedSection.attachments.length > 0 ? (
																<div className="p-4 pt-0 grid grid-cols-3 sm:grid-cols-4 gap-2">
																	{selectedSection.attachments
																		.filter(
																			(
																				a,
																			): a is Extract<
																				EodAttachment,
																				{ kind: "event" }
																			> => a.kind === "event",
																		)
																		.map((a) => {
																			const ev =
																				events.find(
																					(e) => e.id === a.eventId,
																				) ?? null;
																			const img = ev
																				? primaryImagePath(ev)
																				: null;
																			return (
																				<div
																					key={a.eventId}
																					className="relative rounded-md border border-border bg-background/40 overflow-hidden group aspect-video"
																				>
																					{img ? (
																						<img
																							alt=""
																							src={`local-file://${img}`}
																							className="w-full h-full object-cover"
																							loading="lazy"
																						/>
																					) : null}
																					<button
																						type="button"
																						className="absolute top-1 right-1 h-5 w-5 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
																						onClick={() =>
																							removeAttachment(
																								selectedSection.id,
																								a.eventId,
																							)
																						}
																					>
																						<X className="h-3 w-3" />
																					</button>
																				</div>
																			);
																		})}
																</div>
															) : null}
														</div>
													) : (
														<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
															Select a section to edit
														</div>
													)}
												</div>
											</div>
										</FadeIn>
									</>
								) : (
									<>
										<FadeIn delay={0.02}>
											<div className="text-center space-y-2 mb-8">
												<h1 className="text-2xl font-bold">Review</h1>
												<p className="text-sm text-muted-foreground">
													{submittedAt
														? "Already submitted. Updates will be saved."
														: "Ready to wrap up the day?"}
												</p>
											</div>
										</FadeIn>

										<FadeIn delay={0.04}>
											<div className="space-y-8 max-w-3xl mx-auto">
												{content.sections.map((s) => (
													<div key={s.id} className="space-y-3">
														<h2 className="text-lg font-semibold tracking-tight border-b border-border/50 pb-2">
															{s.title}
														</h2>
														<div className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-sm">
															{s.body.trim() || (
																<span className="text-muted-foreground italic">
																	Empty
																</span>
															)}
														</div>
														{s.attachments.length > 0 && (
															<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
																{s.attachments
																	.filter(
																		(
																			a,
																		): a is Extract<
																			EodAttachment,
																			{ kind: "event" }
																		> => a.kind === "event",
																	)
																	.map((a) => {
																		const ev =
																			events.find((e) => e.id === a.eventId) ??
																			null;
																		const img = ev
																			? primaryImagePath(ev)
																			: null;
																		return (
																			<div
																				key={a.eventId}
																				className="rounded-lg border border-border overflow-hidden aspect-video bg-muted/20"
																			>
																				{img ? (
																					<img
																						alt=""
																						src={`local-file://${img}`}
																						className="w-full h-full object-cover"
																						loading="lazy"
																					/>
																				) : null}
																			</div>
																		);
																	})}
															</div>
														)}
													</div>
												))}
											</div>
										</FadeIn>
									</>
								)}
							</motion.div>
						</AnimatePresence>
					</div>
				</ScrollArea>

				<BottomActions
					left={
						step === "summary" ? (
							<GhostButton onClick={closeEod}>
								<X className="h-3.5 w-3.5" />
								Close
							</GhostButton>
						) : (
							<GhostButton onClick={prevStep} disabled={!canGoBack}>
								<ArrowLeft className="h-3.5 w-3.5" />
								Back
							</GhostButton>
						)
					}
					right={
						step === "review" ? (
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

				<Dialog open={attachDialogOpen} onOpenChange={setAttachDialogOpen}>
					<DialogContent className="max-w-5xl">
						<DialogHeader>
							<DialogTitle>Attach events</DialogTitle>
							<DialogDescription>
								Pick screenshots from today to attach to the current section.
							</DialogDescription>
						</DialogHeader>

						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									variant={attachFilter === "all" ? "secondary" : "outline"}
									onClick={() => setAttachFilter("all")}
								>
									All
								</Button>
								<Button
									size="sm"
									variant={
										attachFilter === "progress" ? "secondary" : "outline"
									}
									onClick={() => setAttachFilter("progress")}
								>
									Progress
								</Button>
								<Button
									size="sm"
									variant={attachFilter === "risk" ? "secondary" : "outline"}
									onClick={() => setAttachFilter("risk")}
								>
									Risk
								</Button>
							</div>
							<div className="text-xs text-muted-foreground">
								{attachSelection.size} selected
							</div>
						</div>

						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[55vh] overflow-auto pr-1">
							{attachCandidates.slice(0, 72).map((e) => {
								const img = primaryImagePath(e);
								const selected = attachSelection.has(e.id);
								return (
									<button
										key={e.id}
										type="button"
										className={cn(
											"text-left rounded-lg border overflow-hidden transition-colors bg-background/30",
											selected
												? "border-primary ring-1 ring-primary"
												: "border-border hover:border-primary/40",
										)}
										onClick={() => {
											setAttachSelection((prev) => {
												const next = new Set(prev);
												if (next.has(e.id)) next.delete(e.id);
												else next.add(e.id);
												return next;
											});
										}}
									>
										<div className="aspect-video bg-muted/30 flex items-center justify-center">
											{img ? (
												<img
													alt=""
													src={`local-file://${img}`}
													className="w-full h-full object-cover"
													loading="lazy"
												/>
											) : (
												<div className="text-xs text-muted-foreground">
													No image
												</div>
											)}
										</div>
										<div className="p-2">
											<div className="text-[11px] text-muted-foreground">
												{formatTime(e.timestamp)}
											</div>
											<div className="text-xs text-foreground/90 truncate">
												{e.caption ?? e.appName ?? "—"}
											</div>
										</div>
									</button>
								);
							})}
						</div>

						<DialogFooter className="mt-2">
							<Button
								variant="outline"
								onClick={() => setAttachDialogOpen(false)}
							>
								Cancel
							</Button>
							<Button onClick={applyAttachments}>Attach</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}
