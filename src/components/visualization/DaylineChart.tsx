import { format } from "date-fns";
import { useMemo } from "react";
import { DOT_ALPHA_BY_LEVEL, rgba } from "@/lib/color";
import {
	CATEGORY_RGB,
	type DaylineSlot,
	SLOTS_PER_HOUR,
	slotLevel,
} from "@/lib/dayline";

export type DaylineViewMode = "addiction" | "categories";

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

export function DaylineChart({
	slots,
	mode = "categories",
	currentSlotIdx = null,
}: {
	slots: DaylineSlot[];
	mode?: DaylineViewMode;
	currentSlotIdx?: number | null;
}) {
	const slices = [0, 1, 2, 3, 4, 5] as const;
	const hours = Array.from({ length: 24 }, (_, h) => h);

	return (
		<div
			className="grid gap-[3px] select-none"
			style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
		>
			{hours.map((h) =>
				slices.map((s) => {
					const idx = h * SLOTS_PER_HOUR + s;
					const slot = slots[idx];
					if (!slot)
						return (
							<div
								key={idx}
								className="aspect-square rounded-[2px] bg-muted/20"
							/>
						);

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
							className={`aspect-square rounded-[2px] bg-muted/20 transition-colors ${
								isCurrent ? "ring-1 ring-foreground/30" : ""
							}`}
						/>
					);
				}),
			)}
		</div>
	);
}

export function DaylineLegend({
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
		<div className="flex flex-wrap items-center justify-between gap-y-2 mt-2">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<div className="flex items-center gap-1">
					{intensity.map((l) => (
						<span
							key={l}
							className="h-2 w-2 rounded-[2px] bg-muted/20"
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
						<div key={it.label} className="flex items-center gap-1.5">
							<span
								className="h-2 w-2 rounded-[2px] bg-muted/20"
								style={{ backgroundColor: it.color }}
							/>
							<span>{it.label}</span>
						</div>
					))}
			</div>
		</div>
	);
}
