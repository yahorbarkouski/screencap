import { useMemo } from "react";
import {
	deltaTone,
	formatMinutesDelta,
	formatSignedInt,
} from "@/components/story/StoryView.utils";
import type { DaylineSlot } from "@/lib/dayline";
import { formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { FadeIn, Kpi } from "../EndOfDayFlow.primitives";
import { formatDayTitle, formatMinutes } from "../EndOfDayFlow.utils";
import { ScaledDayline } from "../ScaledDayline";

interface SummaryStepProps {
	dayStartMs: number;
	events: Event[];
	slots: DaylineSlot[];
	progressEvents: Event[];
	riskEvents: Event[];
	loading: boolean;
	submittedAt: number | null;
	isSaving: boolean;
	activeMinutes: number;
	prevActiveMinutes: number;
	focusPct: number;
	prevFocusPct: number;
	riskMinutes: number;
	dominantAddiction: string;
}

export function SummaryStep({
	dayStartMs,
	events,
	slots,
	progressEvents,
	riskEvents,
	loading,
	submittedAt,
	isSaving,
	activeMinutes,
	prevActiveMinutes,
	focusPct,
	prevFocusPct,
	riskMinutes,
	dominantAddiction,
}: SummaryStepProps) {
	const activeDeltaMinutes = activeMinutes - prevActiveMinutes;
	const activeDelta =
		prevActiveMinutes > 0 || activeMinutes > 0
			? formatMinutesDelta(activeDeltaMinutes)
			: undefined;
	const focusDelta = focusPct - prevFocusPct;

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

	const contextSwitches = useMemo(() => {
		let count = 0;
		let lastApp = null;
		// events are typically sorted, but let's be safe
		const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
		for (const e of sorted) {
			if (!e.appName) continue;
			if (lastApp !== null && e.appName !== lastApp) {
				count++;
			}
			lastApp = e.appName;
		}
		return count;
	}, [events]);

	return (
		<>
			<FadeIn delay={0}>
				<div className="flex flex-col items-center justify-center space-y-2 mb-8">
					<div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.28em] text-muted-foreground uppercase">
						<span>End of day</span>
						<span>·</span>
						<span className={submittedAt ? "text-green-500" : ""}>
							{submittedAt ? "Submitted" : isSaving ? "Saving..." : "Draft"}
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

			<FadeIn delay={0.04}>
				<ScaledDayline slots={slots} events={events} dayStartMs={dayStartMs} />
			</FadeIn>

			<FadeIn delay={0.08}>
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
					<Kpi
						label="Active"
						value={formatMinutes(activeMinutes)}
						delta={activeDelta}
						deltaTone={activeDelta ? deltaTone(activeDeltaMinutes) : undefined}
					/>
					<Kpi
						label="Focus"
						value={`${focusPct}%`}
						delta={`${formatSignedInt(focusDelta)}%`}
						deltaTone={deltaTone(focusDelta)}
					/>
					<Kpi label="Context switches" value={String(contextSwitches)} />
					<Kpi
						label="Risk"
						value={formatMinutes(riskMinutes)}
						detail={dominantAddiction === "—" ? undefined : dominantAddiction}
						delta={riskMinutes > 0 ? "Detected" : undefined}
						deltaTone={riskMinutes > 0 ? "down" : "neutral"}
					/>
				</div>
			</FadeIn>
		</>
	);
}
