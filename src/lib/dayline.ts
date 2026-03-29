import { DOT_ALPHA_BY_LEVEL, type Rgb, rgba } from "@/lib/color";
import type { Event, MobileActivityDay } from "@/types";

const BROWSER_APP_NAMES = new Set([
	"Safari",
	"Google Chrome",
	"Firefox",
	"Arc",
	"Brave Browser",
	"Microsoft Edge",
	"Opera",
	"Vivaldi",
	"Chromium",
	"Orion",
	"Zen Browser",
	"Waterfox",
	"DuckDuckGo",
	"Tor Browser",
	"Dia",
]);

function isBrowserApp(appName: string): boolean {
	return BROWSER_APP_NAMES.has(appName);
}

export type ActivityCategory =
	| "Study"
	| "Work"
	| "Leisure"
	| "Chores"
	| "Social"
	| "Unknown";

export type DaylineSlot = {
	startMs: number;
	count: number;
	category: ActivityCategory;
	addiction: string | null;
	appName: string | null;
	source?: "mac" | "iphone" | "both";
	macCount?: number;
	iphoneCount?: number;
};

export const SLOT_MINUTES = 10;
export const SLOTS_PER_HOUR = 6;
export const SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR;

export const CATEGORY_RGB = {
	Study: [59, 130, 246],
	Work: [34, 197, 94],
	Leisure: [168, 85, 247],
	Chores: [250, 204, 21],
	Social: [236, 72, 153],
	Unknown: [107, 114, 128],
} as const satisfies Record<ActivityCategory, Rgb>;

export function toCategory(value: string | null): ActivityCategory {
	if (value === "Study") return "Study";
	if (value === "Work") return "Work";
	if (value === "Leisure") return "Leisure";
	if (value === "Chores") return "Chores";
	if (value === "Social") return "Social";
	return "Unknown";
}

function eventAddictionLabel(e: Event): string | null {
	return e.trackedAddiction ?? e.addictionCandidate ?? null;
}

function dominantMapKey(m: Map<string, number>): string | null {
	let best: string | null = null;
	let bestCount = 0;
	for (const [k, v] of m) {
		if (v > bestCount) {
			best = k;
			bestCount = v;
		}
	}
	return best;
}

function dominantCategory(m: Map<ActivityCategory, number>): ActivityCategory {
	let best: ActivityCategory = "Unknown";
	let bestCount = 0;
	for (const [k, v] of m) {
		if (v > bestCount) {
			best = k;
			bestCount = v;
		}
	}
	return best;
}

export function slotLevel(count: number): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	if (count === 2) return 2;
	if (count === 3) return 3;
	return 4;
}

export interface DaylineOptions {
	showDominantWebsites?: boolean;
}

type IphoneAggregateSlot = {
	count: number;
	categoryCounts: Map<ActivityCategory, number>;
	appCounts: Map<string, number>;
};

export function computeDaylineSlots(
	events: Event[],
	dayStartMs: number,
	options: DaylineOptions = {},
): DaylineSlot[] {
	const { showDominantWebsites = false } = options;
	const slotMs = SLOT_MINUTES * 60 * 1000;
	const slots = Array.from({ length: SLOTS_PER_DAY }, (_, i) => ({
		startMs: dayStartMs + i * slotMs,
		count: 0,
		categoryCounts: new Map<ActivityCategory, number>(),
		addictionCounts: new Map<string, number>(),
		appCounts: new Map<string, number>(),
		websiteCounts: new Map<string, number>(),
	}));

	for (const e of events) {
		const index = Math.floor((e.timestamp - dayStartMs) / slotMs);
		if (index < 0 || index >= slots.length) continue;
		const slot = slots[index];
		slot.count += 1;
		const c = toCategory(e.category);
		slot.categoryCounts.set(c, (slot.categoryCounts.get(c) ?? 0) + 1);
		const addiction = eventAddictionLabel(e);
		if (addiction) {
			slot.addictionCounts.set(
				addiction,
				(slot.addictionCounts.get(addiction) ?? 0) + 1,
			);
		}
		if (e.appName) {
			slot.appCounts.set(e.appName, (slot.appCounts.get(e.appName) ?? 0) + 1);
		}
		if (e.urlHost) {
			const host = e.urlHost.replace(/^www\./, "");
			slot.websiteCounts.set(host, (slot.websiteCounts.get(host) ?? 0) + 1);
		}
	}

	return slots.map(
		({
			startMs,
			count,
			categoryCounts,
			addictionCounts,
			appCounts,
			websiteCounts,
		}) => {
			const dominantApp = dominantMapKey(appCounts);
			const dominantWebsite = dominantMapKey(websiteCounts);

			let appName = dominantApp;
			if (
				showDominantWebsites &&
				dominantApp &&
				isBrowserApp(dominantApp) &&
				dominantWebsite
			) {
				const totalWebsiteEvents = Array.from(websiteCounts.values()).reduce(
					(a, b) => a + b,
					0,
				);
				const dominantWebsiteCount = websiteCounts.get(dominantWebsite) ?? 0;
				if (
					totalWebsiteEvents > 0 &&
					dominantWebsiteCount / totalWebsiteEvents > 0.5
				) {
					appName = dominantWebsite;
				}
			}

			return {
				startMs,
				count,
				category: dominantCategory(categoryCounts),
				addiction: dominantMapKey(addictionCounts),
				appName,
				source: count > 0 ? "mac" : undefined,
				macCount: count,
				iphoneCount: 0,
			};
		},
	);
}

function mobileBucketLevel(durationSeconds: number): number {
	if (durationSeconds <= 0) return 0;
	const minutes = durationSeconds / 60;
	if (minutes <= 15) return 1;
	if (minutes <= 30) return 2;
	if (minutes <= 45) return 3;
	return 4;
}

function chooseWeightedLabel<T extends string>(params: {
	macLabel: T | null;
	macWeight: number;
	iphoneCounts: Map<T, number>;
	fallback: T;
}): T {
	let bestLabel = params.macLabel ?? params.fallback;
	let bestWeight = params.macWeight;
	let bestIsMac = params.macLabel !== null && params.macWeight > 0;

	for (const [label, weight] of params.iphoneCounts) {
		if (weight > bestWeight) {
			bestLabel = label;
			bestWeight = weight;
			bestIsMac = false;
			continue;
		}
		if (weight === bestWeight && bestIsMac) {
			continue;
		}
		if (weight === bestWeight && !bestIsMac && label < bestLabel) {
			bestLabel = label;
		}
	}

	return bestLabel;
}

function buildIphoneAggregateSlots(
	mobileDays: MobileActivityDay[],
	dayStartMs: number,
): IphoneAggregateSlot[] {
	const slots = Array.from({ length: SLOTS_PER_DAY }, () => ({
		count: 0,
		categoryCounts: new Map<ActivityCategory, number>(),
		appCounts: new Map<string, number>(),
	}));

	for (const day of mobileDays) {
		if (day.dayStartMs !== dayStartMs) continue;
		for (const bucket of day.buckets) {
			const level = mobileBucketLevel(bucket.durationSeconds);
			if (level <= 0) continue;
			for (let slice = 0; slice < SLOTS_PER_HOUR; slice += 1) {
				const idx = bucket.hour * SLOTS_PER_HOUR + slice;
				const slot = slots[idx];
				slot.count = Math.max(slot.count, level);
				const category = toCategory(bucket.category);
				slot.categoryCounts.set(
					category,
					(slot.categoryCounts.get(category) ?? 0) + level,
				);
				const mobileLabel =
					bucket.domain &&
					((bucket.appName && isBrowserApp(bucket.appName)) ||
						(!bucket.appName &&
							bucket.appBundleId &&
							isBrowserApp(bucket.appBundleId)))
						? bucket.domain
						: (bucket.appName ?? bucket.domain);
				if (mobileLabel) {
					slot.appCounts.set(
						mobileLabel,
						(slot.appCounts.get(mobileLabel) ?? 0) + level,
					);
				}
			}
		}
	}

	return slots;
}

export function computeCombinedDaylineSlots(
	events: Event[],
	mobileDays: MobileActivityDay[],
	dayStartMs: number,
	options: DaylineOptions = {},
): DaylineSlot[] {
	const macSlots = computeDaylineSlots(events, dayStartMs, options);
	const iphoneSlots = buildIphoneAggregateSlots(mobileDays, dayStartMs);

	return macSlots.map((macSlot, idx) => {
		const iphoneSlot = iphoneSlots[idx];
		const hasMac = macSlot.count > 0;
		const hasIphone = iphoneSlot.count > 0;
		const source =
			hasMac && hasIphone
				? "both"
				: hasIphone
					? "iphone"
					: hasMac
						? "mac"
						: undefined;

		const category = chooseWeightedLabel<ActivityCategory>({
			macLabel: hasMac ? macSlot.category : null,
			macWeight: macSlot.count,
			iphoneCounts: iphoneSlot.categoryCounts,
			fallback: "Unknown",
		});

		const appName =
			hasMac || iphoneSlot.appCounts.size > 0
				? chooseWeightedLabel<string>({
						macLabel: macSlot.appName,
						macWeight: macSlot.appName ? macSlot.count : 0,
						iphoneCounts: iphoneSlot.appCounts,
						fallback: "Unknown",
					})
				: null;

		return {
			startMs: macSlot.startMs,
			count: Math.max(macSlot.count, iphoneSlot.count),
			category,
			addiction: macSlot.addiction,
			appName: appName === "Unknown" ? null : appName,
			source,
			macCount: macSlot.count,
			iphoneCount: iphoneSlot.count,
		};
	});
}

export function countCoveredSlots(events: Event[], dayStartMs: number): number {
	const slotMs = SLOT_MINUTES * 60 * 1000;
	const covered = new Set<number>();

	for (const e of events) {
		const startMs = e.timestamp;
		const endMs = e.endTimestamp ?? e.timestamp;
		const safeEndMs = Math.max(startMs, endMs);
		const startIdx = Math.floor((startMs - dayStartMs) / slotMs);
		const endIdx = Math.floor((safeEndMs - dayStartMs) / slotMs);
		for (let idx = startIdx; idx <= endIdx; idx += 1) {
			if (idx < 0 || idx >= SLOTS_PER_DAY) continue;
			covered.add(idx);
		}
	}

	return covered.size;
}

export function slotBackgroundColor(
	slot: DaylineSlot,
	level: 0 | 1 | 2 | 3 | 4,
): string | null {
	if (slot.count <= 0) return null;
	const alpha = DOT_ALPHA_BY_LEVEL[level];
	if (slot.addiction) return `hsl(var(--destructive) / ${alpha})`;
	return rgba(CATEGORY_RGB[slot.category], alpha);
}
