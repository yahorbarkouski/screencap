import { format } from "date-fns";
import { useMemo } from "react";
import { appNameToRgb, DOT_ALPHA_BY_LEVEL, rgba } from "@/lib/color";
import {
	CATEGORY_RGB,
	type DaylineSlot,
	SLOTS_PER_HOUR,
	slotLevel,
} from "@/lib/dayline";

export type DaylineViewMode = "categories" | "addiction" | "apps";

export const VIEW_MODE_ORDER: DaylineViewMode[] = [
	"categories",
	"addiction",
	"apps",
];

function slotBg(
	slot: DaylineSlot,
	level: 0 | 1 | 2 | 3 | 4,
	mode: DaylineViewMode,
) {
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

function slotTitle(slot: DaylineSlot, mode: DaylineViewMode): string {
	const time = format(new Date(slot.startMs), "HH:mm");
	if (slot.count <= 0) return `${time} · 0`;
	if (mode === "categories")
		return `${time} · ${slot.count} · ${slot.category}`;
	if (mode === "apps")
		return `${time} · ${slot.count} · ${slot.appName ?? "Unknown"}`;
	if (slot.addiction)
		return `${time} · ${slot.count} · Addiction: ${slot.addiction}`;
	return `${time} · ${slot.count} · Non-addiction`;
}

function slotLabel(slot: DaylineSlot, mode: DaylineViewMode): string | null {
	if (slot.count <= 0) return null;
	if (mode === "categories") return slot.category;
	if (mode === "apps") return slot.appName ?? "Unknown";
	return slot.addiction ? "Addiction" : "Non-addiction";
}

function computeSmartTimeMarkers(
	slots: DaylineSlot[],
	mode: DaylineViewMode,
	selectedLabels: Set<string>,
): { hour: number; highlight: boolean }[] {
	const hasSelection = selectedLabels.size > 0;

	// Aggregate counts per hour
	const hourCounts = new Map<number, number>();
	let firstHour: number | null = null;
	let lastHour: number | null = null;

	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i];
		if (slot.count <= 0) continue;

		const label = slotLabel(slot, mode);
		if (hasSelection && (!label || !selectedLabels.has(label))) continue;

		const hour = Math.floor(i / SLOTS_PER_HOUR);
		hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + slot.count);

		if (firstHour === null) firstHour = hour;
		lastHour = hour;
	}

	// No activity - show sparse default markers
	if (firstHour === null || lastHour === null) {
		return [
			{ hour: 6, highlight: false },
			{ hour: 12, highlight: false },
			{ hour: 18, highlight: false },
		];
	}

	// Find peak hour and start of dense activity cluster
	let peakHour = firstHour;
	let peakCount = 0;
	let clusterStartHour: number | null = null;
	let maxClusterDensity = 0;

	for (const [hour, count] of hourCounts) {
		if (count > peakCount) {
			peakCount = count;
			peakHour = hour;
		}
		// Detect start of dense clusters (look for sudden increase in activity)
		const prevCount = hourCounts.get(hour - 1) ?? 0;
		const density = count - prevCount;
		if (density > maxClusterDensity && hour !== firstHour) {
			maxClusterDensity = density;
			clusterStartHour = hour;
		}
	}

	const markers: { hour: number; highlight: boolean }[] = [];
	const usedHours = new Set<number>();
	const MIN_SPACING = 2;

	const canAdd = (hour: number) => {
		if (hour < 0 || hour >= 24) return false;
		for (const used of usedHours) {
			if (Math.abs(used - hour) < MIN_SPACING) return false;
		}
		return true;
	};

	const addMarker = (hour: number, highlight: boolean) => {
		if (!canAdd(hour)) return false;
		usedHours.add(hour);
		markers.push({ hour, highlight });
		return true;
	};

	// Priority order: first, last, peak, cluster start, then fill gaps
	addMarker(firstHour, true);
	addMarker(lastHour, true);

	if (peakHour !== firstHour && peakHour !== lastHour) {
		addMarker(peakHour, true);
	}

	if (
		clusterStartHour !== null &&
		clusterStartHour !== firstHour &&
		clusterStartHour !== lastHour
	) {
		addMarker(clusterStartHour, true);
	}

	// Fill remaining gaps with evenly spaced reference points
	const range = lastHour - firstHour;
	if (range > 6) {
		// Try to add intermediate markers
		const intervals = Math.min(4, Math.floor(range / 3));
		for (let i = 1; i < intervals; i++) {
			const hour = Math.round(firstHour + (range * i) / intervals);
			addMarker(hour, false);
		}
	}

	return markers.sort((a, b) => a.hour - b.hour);
}

export function DaylineTimeMarkers({
	slots,
	mode,
	selectedLabels,
}: {
	slots: DaylineSlot[];
	mode: DaylineViewMode;
	selectedLabels: Set<string>;
}) {
	const markers = useMemo(
		() => computeSmartTimeMarkers(slots, mode, selectedLabels),
		[slots, mode, selectedLabels],
	);

	// Build array of 24 hours, only showing markers where needed
	const hours = Array.from({ length: 24 }, (_, h) => {
		const marker = markers.find((m) => m.hour === h);
		return {
			hour: h,
			show: !!marker,
			highlight: marker?.highlight ?? false,
		};
	});

	return (
		<div className="mt-3 inline-grid grid-cols-[repeat(24,12px)] gap-1">
			{hours.map((h) => (
				<span
					key={`hour-${h.hour}`}
					className={`text-[10px] font-mono tracking-[0.08em] transition-all ${
						h.show
							? h.highlight
								? "text-foreground/70"
								: "text-muted-foreground/50"
							: "text-transparent"
					}`}
				>
					{h.hour.toString().padStart(2, "0")}
				</span>
			))}
		</div>
	);
}

export function Dayline({
	slots,
	mode,
	currentSlotIdx,
	selectedLabels,
	size = "md",
}: {
	slots: DaylineSlot[];
	mode: DaylineViewMode;
	currentSlotIdx?: number | null;
	selectedLabels?: Set<string>;
	size?: "sm" | "md";
}) {
	const slices = [0, 1, 2, 3, 4, 5] as const;
	const hours = Array.from({ length: 24 }, (_, h) => h);
	const hasSelection = selectedLabels ? selectedLabels.size > 0 : false;
	const isSmall = size === "sm";

	// Size constants
	// md: h-3 w-3 (12px), gap-1 (4px) -> grid cols 12px
	// sm: h-1 w-1 (4px), gap-px (1px) -> grid cols 4px
	const cellSize = isSmall ? "h-1 w-1" : "h-3 w-3";
	const gap = isSmall ? "gap-px" : "gap-1";
	const colClass = isSmall
		? "grid-cols-[repeat(24,4px)]"
		: "grid-cols-[repeat(24,12px)]";

	return (
		<div className={`grid grid-rows-6 ${gap}`}>
			{slices.map((s) => (
				<div key={s} className={`inline-grid ${colClass} ${gap}`}>
					{hours.map((h) => {
						const idx = h * SLOTS_PER_HOUR + s;
						const slot = slots[idx];
						const level = slotLevel(slot.count);
						const bg = slotBg(slot, level, mode);
						const title = slotTitle(slot, mode);
						const isCurrent = currentSlotIdx === idx;
						const label = slotLabel(slot, mode);
						const isDimmed =
							hasSelection &&
							selectedLabels &&
							label &&
							!selectedLabels.has(label);
						const style = bg
							? { backgroundColor: bg, opacity: isDimmed ? 0.15 : 1 }
							: undefined;

						return (
							<div
								key={idx}
								style={style}
								title={title}
								className={`${cellSize} rounded bg-muted/50 transition-opacity ${isCurrent ? "ring-1 ring-foreground/30" : ""}`}
							/>
						);
					})}
				</div>
			))}
		</div>
	);
}

export function DayWrappedLegend({
	slots,
	mode,
	selectedLabels,
	onLabelToggle,
}: {
	slots: DaylineSlot[];
	mode: DaylineViewMode;
	selectedLabels: Set<string>;
	onLabelToggle: (label: string) => void;
}) {
	const alpha = DOT_ALPHA_BY_LEVEL[4];
	const hasSelection = selectedLabels.size > 0;

	const legend = useMemo(() => {
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
			const items = [
				{ label: "Addiction", color: `hsl(var(--destructive) / ${alpha})` },
				{ label: "Non-addiction", color: rgba(CATEGORY_RGB.Work, alpha) },
			];
			return items.filter((it) => present.has(it.label));
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
	}, [mode, slots, alpha]);

	const intensity = [1, 2, 3, 4] as const;

	return (
		<div className="mt-4 flex flex-wrap gap-x-4 gap-y-3">
			<div className="flex gap-2 items-center text-xs text-muted-foreground">
				<div className="font-mono text-[10px] tracking-[0.18em]">
					INTENSITY
				</div>
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

			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground gap-y-1">
				{legend.map((it) => {
					const isSelected = selectedLabels.has(it.label);
					const isDimmed = hasSelection && !isSelected;
					return (
						<button
							key={it.label}
							type="button"
							onClick={() => onLabelToggle(it.label)}
							className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-all hover:bg-muted/30 ${isSelected ? "ring-1 ring-foreground/30 bg-muted/20" : ""} ${isDimmed ? "opacity-40" : ""}`}
						>
							<span
								className="h-2.5 w-2.5 rounded-[3px] bg-muted/20"
								style={{ backgroundColor: it.color }}
							/>
							<span className="max-w-32 truncate">{it.label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
