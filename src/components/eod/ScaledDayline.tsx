import { format } from "date-fns";
import { AppWindow, Flame, LayoutGrid } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { EventPreview } from "@/components/timeline/EventPreview";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { appNameToRgb, DOT_ALPHA_BY_LEVEL, rgba } from "@/lib/color";
import {
	CATEGORY_RGB,
	type DaylineSlot,
	SLOT_MINUTES,
	SLOTS_PER_HOUR,
	slotLevel,
} from "@/lib/dayline";
import { cn, formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { primaryImagePath } from "./EndOfDayFlow.utils";

export type DaylineViewMode = "categories" | "addiction" | "apps";

const VIEW_MODE_ORDER: DaylineViewMode[] = ["categories", "apps", "addiction"];
const SLOT_MS = SLOT_MINUTES * 60 * 1000;

function slotBg(
	slot: DaylineSlot,
	level: 0 | 1 | 2 | 3 | 4,
	mode: DaylineViewMode,
): string | null {
	if (slot.count <= 0) return null;
	const alpha = DOT_ALPHA_BY_LEVEL[level];
	if (mode === "categories") return rgba(CATEGORY_RGB[slot.category], alpha);
	if (mode === "apps") {
		if (!slot.appName) return rgba(CATEGORY_RGB.Unknown, alpha);
		return rgba(appNameToRgb(slot.appName), alpha);
	}
	if (slot.addiction) return `hsl(var(--destructive) / ${alpha})`;
	return rgba(CATEGORY_RGB.Work, alpha);
}

function slotLabel(slot: DaylineSlot, mode: DaylineViewMode): string | null {
	if (slot.count <= 0) return null;
	if (mode === "categories") return slot.category;
	if (mode === "apps") return slot.appName ?? "Unknown";
	return slot.addiction ? "Addiction" : "Non-addiction";
}

function computeTimeMarkers(slots: DaylineSlot[]): number[] {
	let firstHour: number | null = null;
	let lastHour: number | null = null;

	for (let i = 0; i < slots.length; i++) {
		if (slots[i].count > 0) {
			const hour = Math.floor(i / SLOTS_PER_HOUR);
			if (firstHour === null) firstHour = hour;
			lastHour = hour;
		}
	}

	if (firstHour === null || lastHour === null) {
		return [0, 6, 12, 18, 23];
	}

	const markers = new Set<number>([0, firstHour, lastHour, 23]);

	const midpoint = Math.floor((firstHour + lastHour) / 2);
	if (midpoint !== firstHour && midpoint !== lastHour) {
		markers.add(midpoint);
	}

	if (lastHour - firstHour > 8) {
		const q1 = Math.floor(firstHour + (lastHour - firstHour) / 4);
		const q3 = Math.floor(firstHour + ((lastHour - firstHour) * 3) / 4);
		markers.add(q1);
		markers.add(q3);
	}

	return Array.from(markers).sort((a, b) => a - b);
}

function getEventsForSlot(
	events: Event[],
	dayStartMs: number,
	slotIndex: number,
): Event[] {
	const slotStart = dayStartMs + slotIndex * SLOT_MS;
	const slotEnd = slotStart + SLOT_MS;

	return events
		.filter((e) => {
			const eventEnd = e.endTimestamp ?? e.timestamp;
			return e.timestamp < slotEnd && eventEnd >= slotStart;
		})
		.sort((a, b) => a.timestamp - b.timestamp);
}

function SlotEventCard({
	event,
	onClick,
}: {
	event: Event;
	onClick: () => void;
}) {
	const imagePath = primaryImagePath(event);

	return (
		<button
			type="button"
			onClick={onClick}
			className="group relative flex gap-4 p-3 rounded-xl border border-border/20 bg-background/40 hover:bg-muted/30 hover:border-border/40 transition-all overflow-hidden text-left w-full hover:shadow-sm"
		>
			<div className="shrink-0 w-44 h-24 rounded-lg overflow-hidden bg-muted/20 border border-white/5 relative shadow-sm group-hover:shadow-md transition-shadow">
				{imagePath ? (
					<img
						src={`local-file://${imagePath}`}
						alt=""
						className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
						loading="lazy"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center text-muted-foreground/20">
						<div className="w-4 h-4 rounded-full border-2 border-current opacity-50" />
					</div>
				)}
			</div>

			<div className="flex-1 min-w-0 flex flex-col py-0.5 gap-2">
				<div className="flex items-center gap-2 text-[10px] leading-none text-muted-foreground">
					<span className="font-mono font-medium opacity-80">
						{formatTime(event.timestamp)}
					</span>

					{event.appName && (
						<>
							<span className="w-0.5 h-0.5 rounded-full bg-border" />
							<span className="truncate text-foreground/70 font-medium">
								{event.appName}
							</span>
						</>
					)}

					{event.category && (
						<div
							className="ml-auto px-1.5 py-0.5 rounded-md text-[9px] font-medium tracking-wide uppercase bg-muted/50 text-muted-foreground/80 border border-white/5"
							style={{
								color: rgba(
									CATEGORY_RGB[event.category as keyof typeof CATEGORY_RGB] ||
										CATEGORY_RGB.Unknown,
									1,
								),
								backgroundColor: rgba(
									CATEGORY_RGB[event.category as keyof typeof CATEGORY_RGB] ||
										CATEGORY_RGB.Unknown,
									0.1,
								),
							}}
						>
							{event.category}
						</div>
					)}
				</div>

				<div className="text-sm font-medium leading-normal text-foreground/90 line-clamp-2 pr-2">
					{event.caption ?? event.windowTitle ?? "No content"}
				</div>

				{event.project && (
					<div className="mt-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
						<div className="w-1.5 h-1.5 rounded-full bg-primary/40 ring-1 ring-primary/20" />
						<span className="truncate font-medium">{event.project}</span>
					</div>
				)}
			</div>
		</button>
	);
}

export function ScaledDayline({
	slots,
	events,
	dayStartMs,
	mode: initialMode = "categories",
}: {
	slots: DaylineSlot[];
	events: Event[];
	dayStartMs: number;
	mode?: DaylineViewMode;
}) {
	const slices = [0, 1, 2, 3, 4, 5] as const;
	const hours = Array.from({ length: 24 }, (_, h) => h);

	const [mode, setMode] = useState<DaylineViewMode>(initialMode);
	const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
	const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(
		null,
	);
	const [previewEvent, setPreviewEvent] = useState<Event | null>(null);

	const handleModeToggle = useCallback(() => {
		const idx = VIEW_MODE_ORDER.indexOf(mode);
		setMode(VIEW_MODE_ORDER[(idx + 1) % VIEW_MODE_ORDER.length]);
		setSelectedLabels(new Set());
	}, [mode]);

	const handleLabelToggle = useCallback((label: string) => {
		setSelectedLabels((prev) => {
			const next = new Set(prev);
			if (next.has(label)) {
				next.delete(label);
			} else {
				next.add(label);
			}
			return next;
		});
	}, []);

	const timeMarkers = useMemo(() => computeTimeMarkers(slots), [slots]);
	const hasLabelSelection = selectedLabels.size > 0;

	const selectedSlot =
		selectedSlotIndex !== null ? slots[selectedSlotIndex] : null;
	const selectedSlotEvents = useMemo(() => {
		if (selectedSlotIndex === null) return [];
		return getEventsForSlot(events, dayStartMs, selectedSlotIndex);
	}, [events, dayStartMs, selectedSlotIndex]);

	const selectedTimeRange = useMemo(() => {
		if (selectedSlot === null) return null;
		const start = format(new Date(selectedSlot.startMs), "HH:mm");
		const end = format(new Date(selectedSlot.startMs + SLOT_MS), "HH:mm");
		return { start, end };
	}, [selectedSlot]);

	const legend = useMemo(() => {
		const alpha = DOT_ALPHA_BY_LEVEL[4];
		if (mode === "categories") {
			const present = new Set<string>();
			for (const slot of slots) {
				if (slot.count > 0) present.add(slot.category);
			}
			const items = [
				{ label: "Study", color: rgba(CATEGORY_RGB.Study, alpha) },
				{ label: "Work", color: rgba(CATEGORY_RGB.Work, alpha) },
				{ label: "Leisure", color: rgba(CATEGORY_RGB.Leisure, alpha) },
				{ label: "Chores", color: rgba(CATEGORY_RGB.Chores, alpha) },
				{ label: "Social", color: rgba(CATEGORY_RGB.Social, alpha) },
				{ label: "Unknown", color: rgba(CATEGORY_RGB.Unknown, alpha) },
			];
			return items.filter((it) => present.has(it.label));
		}
		if (mode === "addiction") {
			const present = new Set<string>();
			for (const slot of slots) {
				if (slot.count > 0)
					present.add(slot.addiction ? "Addiction" : "Non-addiction");
			}
			return [
				{ label: "Addiction", color: `hsl(var(--destructive) / ${alpha})` },
				{ label: "Non-addiction", color: rgba(CATEGORY_RGB.Work, alpha) },
			].filter((it) => present.has(it.label));
		}
		const appCounts = new Map<string, number>();
		for (const slot of slots) {
			if (slot.count <= 0) continue;
			const name = slot.appName ?? "Unknown";
			appCounts.set(name, (appCounts.get(name) ?? 0) + slot.count);
		}
		return Array.from(appCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([name]) => ({
				label: name,
				color:
					name === "Unknown"
						? rgba(CATEGORY_RGB.Unknown, alpha)
						: rgba(appNameToRgb(name), alpha),
			}));
	}, [mode, slots]);

	const intensity = [1, 2, 3, 4] as const;

	return (
		<div className="w-full select-none space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
						{mode === "categories"
							? "Categories"
							: mode === "apps"
								? "Apps"
								: "Addiction"}
					</span>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="size-8 rounded-lg hover:bg-muted/30"
					onClick={handleModeToggle}
				>
					{mode === "categories" && (
						<LayoutGrid className="h-4 w-4 text-muted-foreground" />
					)}
					{mode === "apps" && (
						<AppWindow className="h-4 w-4 text-muted-foreground" />
					)}
					{mode === "addiction" && (
						<Flame className="h-4 w-4 text-muted-foreground" />
					)}
				</Button>
			</div>

			<div
				className="grid gap-[6px]"
				style={{ gridTemplateColumns: "repeat(24, 1fr)" }}
			>
				{slices.map((s) =>
					hours.map((h) => {
						const idx = h * SLOTS_PER_HOUR + s;
						const slot = slots[idx];
						if (!slot) {
							return (
								<div
									key={idx}
									className="aspect-square rounded-lg bg-muted/30"
								/>
							);
						}

						const level = slotLevel(slot.count);
						const bg = slotBg(slot, level, mode);
						const label = slotLabel(slot, mode);
						const hasActivity = slot.count > 0;
						const isLabelDimmed =
							hasLabelSelection && label && !selectedLabels.has(label);
						const isSelected = selectedSlotIndex === idx;

						if (!hasActivity) {
							return (
								<div
									key={idx}
									className="aspect-square rounded-lg bg-muted/30 opacity-50"
								/>
							);
						}

						return (
							<Popover
								key={idx}
								open={isSelected}
								onOpenChange={(open) => {
									if (open) setSelectedSlotIndex(idx);
									else if (isSelected) setSelectedSlotIndex(null);
								}}
							>
								<PopoverTrigger asChild>
									<button
										type="button"
										className={cn(
											"aspect-square rounded-lg bg-muted/30 transition-all",
											hasActivity &&
												"cursor-pointer hover:ring-2 hover:ring-foreground/20",
											isSelected && "ring-2 ring-foreground/50",
										)}
										style={{
											backgroundColor: bg ?? undefined,
											opacity: isLabelDimmed ? 0.15 : 1,
										}}
									/>
								</PopoverTrigger>
								<PopoverContent
									className="w-[500px] p-0 overflow-hidden"
									sideOffset={10}
								>
									<div className="flex flex-col max-h-[320px]">
										<div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/20">
											<div className="flex items-center gap-2">
												<span className="text-sm font-semibold tracking-tight">
													{selectedTimeRange?.start} — {selectedTimeRange?.end}
												</span>
												<span className="text-muted-foreground/40">|</span>
												<span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
													{selectedSlotEvents.length} event
													{selectedSlotEvents.length !== 1 ? "s" : ""}
												</span>
											</div>
										</div>
										<div className="p-3 overflow-y-auto min-h-0">
											{selectedSlotEvents.length > 0 ? (
												<div className="flex flex-col gap-3">
													{selectedSlotEvents.map((event) => (
														<SlotEventCard
															key={event.id}
															event={event}
															onClick={() => setPreviewEvent(event)}
														/>
													))}
												</div>
											) : (
												<div className="py-8 text-center text-sm text-muted-foreground">
													No events captured
												</div>
											)}
										</div>
									</div>
								</PopoverContent>
							</Popover>
						);
					}),
				)}
			</div>

			<div className="grid" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
				{hours.map((h) => {
					const showMarker = timeMarkers.includes(h);
					return (
						<div
							key={h}
							className="text-center font-mono text-sm tracking-tight text-muted-foreground"
						>
							{showMarker ? h.toString().padStart(2, "0") : ""}
						</div>
					);
				})}
			</div>

			<div className="flex flex-wrap items-center justify-between gap-y-3 pt-2">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span className="font-mono text-[10px] tracking-[0.12em]">
						INTENSITY
					</span>
					<div className="flex items-center gap-1">
						{intensity.map((l) => (
							<span
								key={l}
								className="h-3 w-3 rounded-[4px]"
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

				<div className="flex flex-wrap items-center gap-2">
					{legend.map((it) => {
						const isSelected = selectedLabels.has(it.label);
						const isDimmed = hasLabelSelection && !isSelected;
						return (
							<button
								key={it.label}
								type="button"
								onClick={() => handleLabelToggle(it.label)}
								className={cn(
									"flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-all hover:bg-muted/30",
									isSelected && "ring-1 ring-foreground/30 bg-muted/20",
									isDimmed && "opacity-40",
								)}
							>
								<span
									className="h-3 w-3 rounded-[4px]"
									style={{ backgroundColor: it.color }}
								/>
								<span className="text-muted-foreground max-w-28 truncate">
									{it.label}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{previewEvent && (
				<EventPreview
					event={previewEvent}
					open={true}
					onOpenChange={(open) => !open && setPreviewEvent(null)}
				/>
			)}
		</div>
	);
}
