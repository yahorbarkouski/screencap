import { addDays, endOfDay, format, startOfDay, subDays } from "date-fns";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Flame,
	LayoutGrid,
	Power,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShortcutKbd } from "@/components/ui/shortcut-kbd";
import { useSettings } from "@/hooks/useSettings";
import { DOT_ALPHA_BY_LEVEL, rgba } from "@/lib/color";
import {
	CATEGORY_RGB,
	computeDaylineSlots,
	type DaylineSlot,
	SLOTS_PER_HOUR,
	slotLevel,
} from "@/lib/dayline";
import type { Event } from "@/types";
import { useLockBodyScroll } from "./useLockBodyScroll";
import { usePopupAutoHeight } from "./usePopupAutoHeight";

type DaylineViewMode = "addiction" | "categories";

function slotBg(
	slot: DaylineSlot,
	level: 0 | 1 | 2 | 3 | 4,
	mode: DaylineViewMode,
) {
	if (slot.count <= 0) return null;
	const alpha = DOT_ALPHA_BY_LEVEL[level];
	if (mode === "categories") return rgba(CATEGORY_RGB[slot.category], alpha);
	if (slot.addiction) return `hsl(var(--destructive) / ${alpha})`;
	return rgba(CATEGORY_RGB.Work, alpha);
}

function slotTitle(slot: DaylineSlot, mode: DaylineViewMode): string {
	const time = format(new Date(slot.startMs), "HH:mm");
	if (slot.count <= 0) return `${time} · 0`;
	if (mode === "categories")
		return `${time} · ${slot.count} · ${slot.category}`;
	if (slot.addiction)
		return `${time} · ${slot.count} · Addiction: ${slot.addiction}`;
	return `${time} · ${slot.count} · Non-addiction`;
}

function Dayline({
	slots,
	mode,
	currentSlotIdx,
}: {
	slots: DaylineSlot[];
	mode: DaylineViewMode;
	currentSlotIdx: number | null;
}) {
	const slices = [0, 1, 2, 3, 4, 5] as const;
	const hours = Array.from({ length: 24 }, (_, h) => h);

	return (
		<div className="grid grid-rows-6 gap-1">
			{slices.map((s) => (
				<div key={s} className="inline-grid grid-cols-[repeat(24,12px)] gap-1">
					{hours.map((h) => {
						const idx = h * SLOTS_PER_HOUR + s;
						const slot = slots[idx];
						const level = slotLevel(slot.count);
						const bg = slotBg(slot, level, mode);
						const style = bg ? { backgroundColor: bg } : undefined;
						const title = slotTitle(slot, mode);
						const isCurrent = currentSlotIdx === idx;

						return (
							<div
								key={idx}
								style={style}
								title={title}
								className={`h-3 w-3 rounded bg-muted/50 ${isCurrent ? "ring-1 ring-foreground/30" : ""}`}
							/>
						);
					})}
				</div>
			))}
		</div>
	);
}

function DayWrappedLegend({
	slots,
	mode,
}: {
	slots: DaylineSlot[];
	mode: DaylineViewMode;
}) {
	const present = useMemo(() => {
		const s = new Set<string>();
		for (const slot of slots) {
			if (slot.count <= 0) continue;
			if (mode === "categories") s.add(slot.category);
			else s.add(slot.addiction ? "Addiction" : "Non-addiction");
		}
		return s;
	}, [mode, slots]);

	const alpha = DOT_ALPHA_BY_LEVEL[4];
	const legend =
		mode === "categories"
			? ([
					{ label: "Study", color: rgba(CATEGORY_RGB.Study, alpha) },
					{ label: "Work", color: rgba(CATEGORY_RGB.Work, alpha) },
					{ label: "Leisure", color: rgba(CATEGORY_RGB.Leisure, alpha) },
					{ label: "Chores", color: rgba(CATEGORY_RGB.Chores, alpha) },
					{ label: "Social", color: rgba(CATEGORY_RGB.Social, alpha) },
					{ label: "Unknown", color: rgba(CATEGORY_RGB.Unknown, alpha) },
				] as const)
			: ([
					{ label: "Addiction", color: `hsl(var(--destructive) / ${alpha})` },
					{ label: "Non-addiction", color: rgba(CATEGORY_RGB.Work, alpha) },
				] as const);

	const intensity = [1, 2, 3, 4] as const;

	return (
		<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
								backgroundColor: rgba(CATEGORY_RGB.Work, DOT_ALPHA_BY_LEVEL[l]),
							}}
						/>
					))}
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
				{legend
					.filter((it) => present.has(it.label))
					.map((it) => (
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
	);
}

export function StreakPopup() {
	const [events, setEvents] = useState<Event[]>([]);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [isQuitConfirmOpen, setIsQuitConfirmOpen] = useState(false);
	const [daylineMode, setDaylineMode] = useState<DaylineViewMode>("categories");
	const [day, setDay] = useState(() => startOfDay(new Date()));
	const { settings } = useSettings();
	const todayStartMs = useMemo(() => startOfDay(new Date()).getTime(), []);
	const dayStartMs = useMemo(() => startOfDay(day).getTime(), [day]);
	const dayEndMs = useMemo(() => endOfDay(day).getTime(), [day]);
	const canGoForward = dayStartMs < todayStartMs;

	useLockBodyScroll(true);
	usePopupAutoHeight(rootRef);

	useEffect(() => {
		const fetchEvents = async () => {
			if (!window.api) return;
			const result = await window.api.storage.getEvents({
				startDate: dayStartMs,
				endDate: dayEndMs,
				dismissed: false,
			});
			setEvents(result);
		};
		void fetchEvents();
		const interval = setInterval(fetchEvents, 30000);
		return () => clearInterval(interval);
	}, [dayEndMs, dayStartMs]);

	const slots = useMemo(
		() => computeDaylineSlots(events, dayStartMs),
		[events, dayStartMs],
	);
	const titleDate = format(day, "EEE, MMM d");

	const isToday = dayStartMs === todayStartMs;
	const currentSlotIdx = useMemo(() => {
		if (!isToday) return null;
		const now = new Date();
		const hour = now.getHours();
		const minute = now.getMinutes();
		return hour * SLOTS_PER_HOUR + Math.floor(minute / 10);
	}, [isToday]);

	const triggerCaptureNow = useCallback(() => {
		if (!window.api) return;
		void window.api.capture.trigger();
		window.close();
	}, []);

	const triggerProjectProgressCapture = useCallback(() => {
		if (!window.api?.popup?.startProjectProgressCapture) return;
		void window.api.popup.startProjectProgressCapture();
		window.close();
	}, []);

	const triggerEndOfDay = useCallback(() => {
		if (!window.api?.eod?.openFlow) return;
		void window.api.eod.openFlow();
		window.close();
	}, []);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("shortcut:capture-now", () => {
			triggerCaptureNow();
		});
	}, [triggerCaptureNow]);

	return (
		<div
			ref={rootRef}
			className="relative w-full bg-background/95 backdrop-blur-xl p-4 rounded-xl border border-border"
		>
			{isQuitConfirmOpen && (
				<div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
					<div className="w-full max-w-[320px] rounded-lg border border-border bg-background p-4 shadow-xl">
						<div className="text-sm font-medium text-foreground">
							Quit Screencap?
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							This will stop capturing until you reopen the app.
						</div>
						<div className="mt-4 grid grid-cols-2 gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => setIsQuitConfirmOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => {
									if (!window.api) return;
									void window.api.app.quit();
								}}
							>
								Quit
							</Button>
						</div>
					</div>
				</div>
			)}

			<div className="absolute right-2 top-2 flex items-center gap-1">
				<button
					type="button"
					aria-label="Quit app"
					className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
					onClick={() => {
						if (!window.api) return;
						setIsQuitConfirmOpen(true);
					}}
				>
					<Power className="size-3" />
				</button>

				<button
					type="button"
					aria-label={
						daylineMode === "addiction" ? "Show categories" : "Show addiction"
					}
					className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
					onClick={() =>
						setDaylineMode((m) =>
							m === "addiction" ? "categories" : "addiction",
						)
					}
				>
					{daylineMode === "addiction" ? (
						<LayoutGrid className="size-3" />
					) : (
						<Flame className="size-3" />
					)}
				</button>

				<button
					type="button"
					aria-label="Close"
					className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
					onClick={() => window.close()}
				>
					<X className="size-3" />
				</button>
			</div>

			<div className="mb-3 pr-20">
				<div className="flex items-center gap-1.5">
					<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
						DAY WRAPPED
					</div>
					<button
						type="button"
						aria-label="Previous day"
						className="inline-flex size-4 items-center justify-center rounded-md border border-border bg-background/30 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
						onClick={() => setDay((d) => startOfDay(subDays(d, 1)))}
					>
						<ChevronLeft className="size-2" />
					</button>

					<button
						type="button"
						aria-label="Next day"
						disabled={!canGoForward}
						className={`inline-flex size-4 items-center justify-center rounded-md border border-border bg-background/30 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground ${canGoForward ? "" : "pointer-events-none opacity-0"}`}
						onClick={() => setDay((d) => startOfDay(addDays(d, 1)))}
					>
						<ChevronRight className="size-2" />
					</button>
				</div>
				<div className="flex mt-0.5 items-center gap-1.5">
					<div className="text-sm font-medium text-foreground/90 text-center">
						{titleDate}
					</div>
				</div>
			</div>

			<Dayline
				slots={slots}
				mode={daylineMode}
				currentSlotIdx={currentSlotIdx}
			/>
			<div className="mt-3 flex justify-between text-[10px] font-mono tracking-[0.18em] text-muted-foreground">
				<span>00</span>
				<span>06</span>
				<span>12</span>
				<span>18</span>
				<span>24</span>
			</div>

			<DayWrappedLegend slots={slots} mode={daylineMode} />

			<div className="mt-4 space-y-2">
				<Button
					size="sm"
					className="w-full justify-between bg-primary/15 text-primary hover:bg-primary/20"
					onClick={triggerEndOfDay}
					disabled={!window.api}
				>
					<span>End of day</span>
					<ShortcutKbd
						accelerator={settings.shortcuts.endOfDay}
						className="h-4 px-1 text-[9px] rounded-sm"
					/>
				</Button>

				<div className="grid grid-cols-2 gap-2">
					<Button
						size="sm"
						variant="outline"
						className="w-full hover:bg-primary/10"
						onClick={() => {
							window.api?.window.show();
							window.close();
						}}
						disabled={!window.api}
					>
						Open app
					</Button>

					<DropdownMenu>
						<div className="flex w-full">
							<Button
								size="sm"
								className="flex-1 justify-center rounded-r-none bg-accent/20 text-accent-foreground hover:bg-accent/30"
								onClick={triggerCaptureNow}
								disabled={!window.api}
							>
								<span>Capture now</span>
							</Button>
							<DropdownMenuTrigger asChild>
								<Button
									size="sm"
									className="rounded-l-none px-2 bg-accent/20 text-accent-foreground hover:bg-accent/30 border-l border-border/40"
									disabled={!window.api}
									aria-label="Capture options"
								>
									<ChevronDown className="size-3" />
								</Button>
							</DropdownMenuTrigger>
						</div>
						<DropdownMenuContent align="end" side="top" avoidCollisions={false}>
							<DropdownMenuItem
								onSelect={triggerProjectProgressCapture}
								className="flex items-center justify-between gap-3"
							>
								<span>Capture project progress</span>
								<ShortcutKbd
									accelerator={settings.shortcuts.captureProjectProgress}
									className="h-4 px-1 text-[9px] rounded-sm"
								/>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	);
}
