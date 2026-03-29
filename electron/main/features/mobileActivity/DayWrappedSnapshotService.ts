import { endOfDay, format, startOfDay } from "date-fns";
import type {
	AutomationCategory,
	Event,
	MobileActivityDay,
} from "../../../shared/types";
import { getEvents } from "../../infra/db/repositories/EventRepository";
import { listCachedMobileActivityDays } from "../../infra/db/repositories/MobileActivityDayRepository";
import { getSettings } from "../../infra/settings";

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

export type MobileWrappedSource = "none" | "mac" | "iphone" | "both";

export interface MobileWrappedSlot {
	id: number;
	startMs: number;
	count: number;
	category: AutomationCategory;
	appName: string | null;
	source: MobileWrappedSource;
	macCount: number;
	iphoneCount: number;
}

export interface MobileDayWrappedSnapshot {
	dayStartMs: number;
	title: string;
	subtitle: string;
	updatedAtMs: number;
	sourceSummary: string;
	pairedDeviceName: string | null;
	mode: "categories";
	slots: MobileWrappedSlot[];
}

const SLOT_MINUTES = 10;
const SLOTS_PER_HOUR = 6;
const SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR;

type ActivityCategory = AutomationCategory;

type IphoneAggregateSlot = {
	count: number;
	categoryCounts: Map<ActivityCategory, number>;
	appCounts: Map<string, number>;
};

function isBrowserApp(appName: string): boolean {
	return BROWSER_APP_NAMES.has(appName);
}

function toCategory(value: string | null): ActivityCategory {
	if (value === "Study") return "Study";
	if (value === "Work") return "Work";
	if (value === "Leisure") return "Leisure";
	if (value === "Chores") return "Chores";
	if (value === "Social") return "Social";
	return "Unknown";
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

function computeMacSlots(
	events: Event[],
	dayStartMs: number,
	showDominantWebsites: boolean,
): MobileWrappedSlot[] {
	const slotMs = SLOT_MINUTES * 60 * 1000;
	const slots = Array.from({ length: SLOTS_PER_DAY }, (_, i) => ({
		startMs: dayStartMs + i * slotMs,
		count: 0,
		categoryCounts: new Map<ActivityCategory, number>(),
		appCounts: new Map<string, number>(),
		websiteCounts: new Map<string, number>(),
	}));

	for (const event of events) {
		const index = Math.floor((event.timestamp - dayStartMs) / slotMs);
		if (index < 0 || index >= slots.length) continue;
		const slot = slots[index];
		slot.count += 1;
		const category = toCategory(event.category);
		slot.categoryCounts.set(
			category,
			(slot.categoryCounts.get(category) ?? 0) + 1,
		);
		if (event.appName) {
			slot.appCounts.set(
				event.appName,
				(slot.appCounts.get(event.appName) ?? 0) + 1,
			);
		}
		if (event.urlHost) {
			const host = event.urlHost.replace(/^www\./, "");
			slot.websiteCounts.set(host, (slot.websiteCounts.get(host) ?? 0) + 1);
		}
	}

	return slots.map(
		({ startMs, count, categoryCounts, appCounts, websiteCounts }, index) => {
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
					(sum, value) => sum + value,
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
				id: index,
				startMs,
				count,
				category: dominantCategory(categoryCounts),
				appName,
				source: count > 0 ? "mac" : "none",
				macCount: count,
				iphoneCount: 0,
			} satisfies MobileWrappedSlot;
		},
	);
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
				if (bucket.appName) {
					slot.appCounts.set(
						bucket.appName,
						(slot.appCounts.get(bucket.appName) ?? 0) + level,
					);
				}
			}
		}
	}

	return slots;
}

export function computeCombinedWrappedSlots(
	events: Event[],
	mobileDays: MobileActivityDay[],
	dayStartMs: number,
	showDominantWebsites: boolean,
): MobileWrappedSlot[] {
	const macSlots = computeMacSlots(events, dayStartMs, showDominantWebsites);
	const iphoneSlots = buildIphoneAggregateSlots(mobileDays, dayStartMs);

	return macSlots.map((macSlot, idx) => {
		const iphoneSlot = iphoneSlots[idx];
		const hasMac = macSlot.count > 0;
		const hasIphone = iphoneSlot.count > 0;
		const source: MobileWrappedSource =
			hasMac && hasIphone
				? "both"
				: hasIphone
					? "iphone"
					: hasMac
						? "mac"
						: "none";

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
			id: idx,
			startMs: macSlot.startMs,
			count: Math.max(macSlot.count, iphoneSlot.count),
			category,
			appName: appName === "Unknown" ? null : appName,
			source,
			macCount: macSlot.count,
			iphoneCount: iphoneSlot.count,
		};
	});
}

export function buildCombinedDayWrappedSnapshot(
	dayStartMs: number,
): MobileDayWrappedSnapshot {
	const start = startOfDay(new Date(dayStartMs));
	const normalizedDayStartMs = start.getTime();
	const events = getEvents({
		startDate: normalizedDayStartMs,
		endDate: endOfDay(start).getTime(),
		dismissed: false,
	});
	const mobileDays = listCachedMobileActivityDays({
		startDate: normalizedDayStartMs,
		endDate: normalizedDayStartMs,
	});
	const slots = computeCombinedWrappedSlots(
		events,
		mobileDays,
		normalizedDayStartMs,
		getSettings().showDominantWebsites,
	);
	const hasMac = slots.some(
		(slot) => slot.source === "mac" || slot.source === "both",
	);
	const hasIphone = slots.some(
		(slot) => slot.source === "iphone" || slot.source === "both",
	);

	let sourceSummary = "No activity";
	if (hasMac && hasIphone) sourceSummary = "Mac + iPhone";
	else if (hasMac) sourceSummary = "Mac";
	else if (hasIphone) sourceSummary = "iPhone";

	const updatedAtMs = Math.max(
		normalizedDayStartMs,
		...events.map((event) => event.timestamp),
		...mobileDays.map((day) => day.syncedAt),
	);
	const pairedDeviceName =
		mobileDays
			.map((day) => day.deviceName)
			.find((deviceName): deviceName is string => Boolean(deviceName)) ?? null;

	return {
		dayStartMs: normalizedDayStartMs,
		title: "DAY WRAPPED",
		subtitle: format(start, "EEE, MMM d"),
		updatedAtMs,
		sourceSummary,
		pairedDeviceName,
		mode: "categories",
		slots,
	};
}
