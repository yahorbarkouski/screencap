import type { CountItem } from "@/components/wrapped/CountList";
import { SLOT_MINUTES, SLOTS_PER_DAY } from "@/lib/dayline";
import type { Event } from "@/types";

export type JournalScope = "all" | "journal" | "addiction";

export type CategoryStat = { category: string; count: number };

export type StoryLlmEvent = {
	caption: string;
	category: string;
	timestamp: number;
	project?: string | null;
	projectProgress?: boolean;
};

export type AddictionStreak = {
	minutes: number;
	addiction: string | null;
	startMs: number | null;
	endMs: number | null;
};

export type DeltaTone = "up" | "down" | "neutral";

export function longestRun(values: readonly boolean[]): number {
	let best = 0;
	let current = 0;
	for (const v of values) {
		if (v) {
			current += 1;
			if (current > best) best = current;
		} else {
			current = 0;
		}
	}
	return best;
}

export function topCounts(
	values: Array<string | null>,
	n: number,
): CountItem[] {
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

export function isRiskEvent(e: Event): boolean {
	return !!e.trackedAddiction;
}

export function riskRule(e: Event): string | null {
	return e.trackedAddiction;
}

export function riskSource(e: Event): string | null {
	return e.urlHost ?? e.appName ?? null;
}

function fillSlotRange(
	perSlot: Array<Map<string, number>>,
	dayStartMs: number,
	startMs: number,
	endMs: number,
	label: string,
) {
	const slotMs = SLOT_MINUTES * 60 * 1000;
	const safeEndMs = Math.max(startMs, endMs);
	const startIdx = Math.floor((startMs - dayStartMs) / slotMs);
	const endIdx = Math.floor((safeEndMs - dayStartMs) / slotMs);
	for (let idx = startIdx; idx <= endIdx; idx += 1) {
		if (idx < 0 || idx >= perSlot.length) continue;
		const m = perSlot[idx];
		m.set(label, (m.get(label) ?? 0) + 1);
	}
}

export function computeAddictionStreak(
	events: Event[],
	dayStartMs: number,
): AddictionStreak {
	const perSlot = Array.from(
		{ length: SLOTS_PER_DAY },
		() => new Map<string, number>(),
	);

	for (const e of events) {
		if (!e.trackedAddiction) continue;
		fillSlotRange(
			perSlot,
			dayStartMs,
			e.timestamp,
			e.endTimestamp ?? e.timestamp,
			e.trackedAddiction,
		);
	}

	const slotLabel = perSlot.map((m) => {
		if (m.size === 0) return null;
		let best: string | null = null;
		let bestCount = 0;
		for (const [k, v] of m) {
			if (v > bestCount) {
				best = k;
				bestCount = v;
			}
		}
		return best;
	});

	let bestLen = 0;
	let bestStart = -1;
	let bestLabel: string | null = null;

	let curLen = 0;
	let curStart = 0;
	let curLabel: string | null = null;

	for (let i = 0; i < slotLabel.length; i += 1) {
		const v = slotLabel[i];
		if (v && v === curLabel) {
			curLen += 1;
		} else if (v) {
			curLabel = v;
			curLen = 1;
			curStart = i;
		} else {
			curLabel = null;
			curLen = 0;
		}

		if (curLen > bestLen) {
			bestLen = curLen;
			bestStart = curStart;
			bestLabel = curLabel;
		}
	}

	if (bestLen <= 0 || !bestLabel) {
		return { minutes: 0, addiction: null, startMs: null, endMs: null };
	}

	const slotMs = SLOT_MINUTES * 60 * 1000;
	const startMs = dayStartMs + bestStart * slotMs;
	const endMs = dayStartMs + (bestStart + bestLen) * slotMs;
	return {
		minutes: bestLen * SLOT_MINUTES,
		addiction: bestLabel,
		startMs,
		endMs,
	};
}

export function deltaTone(delta: number): DeltaTone {
	if (delta > 0) return "up";
	if (delta < 0) return "down";
	return "neutral";
}

export function invertedDeltaTone(delta: number): DeltaTone {
	if (delta > 0) return "down";
	if (delta < 0) return "up";
	return "neutral";
}

export function formatSignedInt(delta: number): string {
	return `${delta >= 0 ? "+" : ""}${delta}`;
}

export function formatMinutesCompact(minutes: number): string {
	if (minutes <= 0) return "0m";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h <= 0) return `${m}m`;
	if (m <= 0) return `${h}h`;
	return `${h}h ${m}m`;
}

export function formatMinutesDelta(deltaMinutes: number): string {
	if (deltaMinutes === 0) return "0m";
	const sign = deltaMinutes > 0 ? "+" : "-";
	return `${sign}${formatMinutesCompact(Math.abs(deltaMinutes))}`;
}
