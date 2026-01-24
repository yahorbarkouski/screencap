import type { ClassificationResult, Event } from "../../../../shared/types";
import { getEvents } from "../../../infra/db/repositories/EventRepository";
import { getMemories } from "../../../infra/db/repositories/MemoryRepository";
import { createLogger } from "../../../infra/log";
import type { ClassificationProvider, ProviderAvailability } from "../types";

const logger = createLogger({ scope: "LocalRetrievalProvider" });

const MAX_CANDIDATES = 250;
const MIN_CATEGORY_SAMPLES = 25;
const MIN_CATEGORY_RATIO = 0.75;
const MIN_PROJECT_SAMPLES = 10;
const MIN_PROJECT_RATIO = 0.75;
const MIN_TAG_EVENTS = 10;
const MIN_TAG_RATIO = 0.15;
const MAX_TAGS = 8;

type Label = "Study" | "Work" | "Leisure" | "Chores" | "Social" | "Unknown";

function buildCaption(context: {
	contentTitle: string | null;
	windowTitle: string | null;
	appName: string | null;
	urlHost: string | null;
}): string {
	const parts = [
		context.contentTitle?.trim() ?? "",
		context.windowTitle?.trim() ?? "",
		context.appName?.trim() ?? "",
		context.urlHost?.trim() ?? "",
	].filter((v) => v.length > 0);
	return parts[0] ?? "Screenshot captured";
}

function compact(value: string | null | undefined): string | null {
	const v = (value ?? "").trim();
	return v.length > 0 ? v : null;
}

function hasAnyProject(events: Event[]): boolean {
	for (const e of events) {
		if (e.status !== "completed") continue;
		if (compact(e.project)) return true;
	}
	return false;
}

function asLabel(value: string | null): Label | null {
	if (!value) return null;
	if (
		value === "Study" ||
		value === "Work" ||
		value === "Leisure" ||
		value === "Chores" ||
		value === "Social" ||
		value === "Unknown"
	) {
		return value;
	}
	return null;
}

function majority<T extends string>(
	values: T[],
): { value: T; ratio: number; count: number } | null {
	if (values.length === 0) return null;
	const counts = new Map<T, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: { value: T; count: number } | null = null;
	for (const [value, count] of counts) {
		if (!best || count > best.count) best = { value, count };
	}
	if (!best) return null;
	return {
		value: best.value,
		count: best.count,
		ratio: best.count / values.length,
	};
}

function candidateEvents(input: {
	appBundleId: string | null;
	urlHost: string | null;
}): Event[] {
	if (input.urlHost) {
		return getEvents({ urlHost: input.urlHost, limit: MAX_CANDIDATES });
	}
	if (input.appBundleId) {
		return getEvents({ appBundleId: input.appBundleId, limit: MAX_CANDIDATES });
	}
	return [];
}

function pickCategory(
	events: Event[],
): { category: Label; confidence: number } | null {
	const completed = events.filter((e) => e.status === "completed");
	const labelsAll = completed
		.map((e) => asLabel(e.category))
		.filter((l): l is Label => !!l);

	const labelsNoUnknown = labelsAll.filter((l) => l !== "Unknown");
	const base =
		labelsNoUnknown.length >= MIN_CATEGORY_SAMPLES
			? labelsNoUnknown
			: labelsAll;

	if (base.length < MIN_CATEGORY_SAMPLES) return null;
	const maj = majority(base);
	if (!maj) return null;
	if (maj.ratio < MIN_CATEGORY_RATIO) return null;

	const confidence = Math.min(0.95, Math.max(0, maj.ratio));
	return { category: maj.value, confidence };
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function matchProjectFromText(
	projectsByCount: Map<string, number>,
	text: string | null,
): string | null {
	const haystack = normalizeWhitespace(text ?? "").toLowerCase();
	if (haystack.length === 0) return null;

	let best: { project: string; count: number; length: number } | null = null;
	for (const [project, count] of projectsByCount) {
		const needle = normalizeWhitespace(project).toLowerCase();
		if (needle.length < 3) continue;
		if (!haystack.includes(needle)) continue;
		const candidate = { project, count, length: needle.length };
		if (
			!best ||
			candidate.count > best.count ||
			(candidate.count === best.count && candidate.length > best.length)
		) {
			best = candidate;
		}
	}
	return best?.project ?? null;
}

function pickProject(input: {
	events: Event[];
	textHints: Array<string | null>;
}): string | null {
	const completed = input.events.filter((e) => e.status === "completed");
	const projects = completed
		.map((e) => compact(e.project))
		.filter((p): p is string => !!p);

	if (projects.length < MIN_PROJECT_SAMPLES) return null;

	const projectsByCount = new Map<string, number>();
	for (const p of projects)
		projectsByCount.set(p, (projectsByCount.get(p) ?? 0) + 1);

	for (const hint of input.textHints) {
		const matched = matchProjectFromText(projectsByCount, hint);
		if (matched) return matched;
	}

	const maj = majority(projects);
	if (!maj) return null;
	if (maj.ratio < MIN_PROJECT_RATIO) return null;
	return maj.value;
}

function safeParseStringArray(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((v) => String(v))
			.map((v) => v.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function pickTags(input: {
	events: Event[];
	project: string | null;
}): string[] {
	const completed = input.events.filter((e) => e.status === "completed");
	const base =
		input.project !== null
			? completed.filter((e) => compact(e.project) === input.project)
			: completed;

	const total = base.length;
	if (total < MIN_TAG_EVENTS) return [];

	type TagStats = { count: number; originals: Map<string, number> };
	const stats = new Map<string, TagStats>();

	for (const e of base) {
		const tags = safeParseStringArray(e.tags);
		if (tags.length === 0) continue;
		const perEvent = new Map<string, string>();
		for (const tag of tags) {
			const norm = tag.toLowerCase();
			if (!perEvent.has(norm)) perEvent.set(norm, tag);
		}
		for (const [norm, original] of perEvent) {
			const entry = stats.get(norm) ?? { count: 0, originals: new Map() };
			entry.count += 1;
			entry.originals.set(original, (entry.originals.get(original) ?? 0) + 1);
			stats.set(norm, entry);
		}
	}

	const picked = [...stats.entries()]
		.filter(([, s]) => s.count / total >= MIN_TAG_RATIO)
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, MAX_TAGS)
		.map(([, s]) => {
			let best: { value: string; count: number } | null = null;
			for (const [value, count] of s.originals) {
				if (!best || count > best.count) best = { value, count };
			}
			return best?.value ?? null;
		})
		.filter((v): v is string => !!v);

	return picked;
}

export const localRetrievalProvider: ClassificationProvider = {
	id: "local.retrieval",

	async isAvailable(): Promise<ProviderAvailability> {
		return { available: true, reason: null };
	},

	async classify(input): Promise<ClassificationResult | null> {
		const memories = getMemories();
		const addictions = memories.filter((m) => m.type === "addiction");

		if (addictions.length > 0) {
			logger.info(
				"Skipping local retrieval: addictions configured, need LLM for detection",
				{ addictionsCount: addictions.length },
			);
			return null;
		}

		const ctx = input.context;
		const candidates = candidateEvents({
			appBundleId: ctx?.appBundleId ?? null,
			urlHost: ctx?.urlHost ?? null,
		});

		if (hasAnyProject(candidates)) return null;

		const picked = pickCategory(candidates);
		if (!picked) return null;

		const project = pickProject({
			events: candidates,
			textHints: [
				ctx?.contentTitle ?? null,
				ctx?.windowTitle ?? null,
				ctx?.userCaption ?? null,
				input.ocrText ?? null,
			],
		});
		const tags = pickTags({ events: candidates, project });

		const caption = buildCaption({
			contentTitle: ctx?.contentTitle ?? null,
			windowTitle: ctx?.windowTitle ?? null,
			appName: ctx?.appName ?? null,
			urlHost: ctx?.urlHost ?? null,
		});

		logger.info("Local retrieval succeeded", {
			category: picked.category,
			confidence: picked.confidence,
			project,
		});

		return {
			category: picked.category,
			subcategories: [],
			project,
			project_progress: { shown: false, confidence: 0 },
			potential_progress: false,
			tags,
			confidence: picked.confidence,
			caption,
			tracked_addiction: { detected: false, name: null },
			addiction_candidate: null,
			addiction_confidence: null,
			addiction_prompt: null,
		};
	},
};
