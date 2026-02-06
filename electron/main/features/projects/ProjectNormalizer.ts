import {
	getDatabase,
	getProjectCounts,
	isDbOpen,
	updateProjectName,
} from "../../infra/db";
import { getProjectMemories } from "../../infra/db/repositories/MemoryRepository";
import { createLogger } from "../../infra/log";

const logger = createLogger({ scope: "ProjectNormalizer" });

const TAIL_STOPWORDS = new Set([
	"app",
	"application",
	"config",
	"configuration",
	"dashboard",
	"home",
	"launch",
	"open",
	"opened",
	"opening",
	"preferences",
	"settings",
	"setup",
	"start",
	"startup",
]);

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function stripOuterQuotes(value: string): string {
	const v = value.trim();
	if (v.length < 2) return v;
	const first = v[0];
	const last = v[v.length - 1];
	if (
		(first === '"' && last === '"') ||
		(first === "'" && last === "'") ||
		(first === "`" && last === "`")
	) {
		return v.slice(1, -1).trim();
	}
	return v;
}

function baseTokens(raw: string): string[] {
	const cleaned = stripOuterQuotes(raw)
		.replace(/[·•]/g, " ")
		.replace(/[_/\\|]+/g, " ")
		.replace(/[()[\]{}<>]+/g, " ")
		.replace(/[.,:;!?]+/g, " ");

	const tokens = normalizeWhitespace(cleaned).split(" ").filter(Boolean);

	while (tokens.length > 1) {
		const last = tokens[tokens.length - 1];
		if (!TAIL_STOPWORDS.has(last.toLowerCase())) break;
		tokens.pop();
	}

	return tokens;
}

function toKeyFromTokens(tokens: string[]): string {
	return tokens
		.join(" ")
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

function toDisplayFromTokens(tokens: string[]): string {
	const joined = tokens.join(" ").trim();
	if (!joined) return joined;
	const hasUpper = /[A-Z]/.test(joined);
	if (hasUpper) return joined;
	return joined[0].toUpperCase() + joined.slice(1);
}

export function normalizeProjectBase(
	raw: string | null | undefined,
): string | null {
	if (!raw) return null;
	const tokens = baseTokens(raw);
	const display = toDisplayFromTokens(tokens);
	return display ? normalizeWhitespace(display) : null;
}

export function projectKeyFromBase(base: string | null): string | null {
	if (!base) return null;
	const tokens = baseTokens(base);
	const key = toKeyFromTokens(tokens);
	return key || null;
}

type CanonicalGroup = {
	memoryCanonical?: string;
	rawVariants: Map<string, number>;
	baseCounts: Map<string, number>;
};

function chooseCanonical(group: CanonicalGroup): string | null {
	if (group.memoryCanonical) return group.memoryCanonical;
	let best: { base: string; count: number } | null = null;

	for (const [base, count] of Array.from(group.baseCounts.entries())) {
		if (!best) {
			best = { base, count };
			continue;
		}
		if (count > best.count) {
			best = { base, count };
			continue;
		}
		if (count === best.count) {
			const a = base.trim();
			const b = best.base.trim();
			if (a.length < b.length) {
				best = { base, count };
				continue;
			}
			if (
				a.length === b.length &&
				a.localeCompare(b, undefined, { sensitivity: "base" }) < 0
			) {
				best = { base, count };
			}
		}
	}

	return best?.base ?? null;
}

function buildGroups(): Map<string, CanonicalGroup> {
	const groups = new Map<string, CanonicalGroup>();

	const memoryRows = getProjectMemories();

	for (const row of memoryRows) {
		const base = normalizeProjectBase(row.content);
		const key = projectKeyFromBase(base);
		if (!base || !key) continue;
		const group = groups.get(key) ?? {
			rawVariants: new Map<string, number>(),
			baseCounts: new Map<string, number>(),
		};
		if (!group.memoryCanonical) group.memoryCanonical = base;
		groups.set(key, group);
	}

	const projectRows = getProjectCounts();

	for (const row of projectRows) {
		const raw = normalizeWhitespace(row.project);
		const base = normalizeProjectBase(raw);
		const key = projectKeyFromBase(base);
		if (!base || !key) continue;
		const group = groups.get(key) ?? {
			rawVariants: new Map<string, number>(),
			baseCounts: new Map<string, number>(),
		};
		group.rawVariants.set(raw, (group.rawVariants.get(raw) ?? 0) + row.count);
		group.baseCounts.set(base, (group.baseCounts.get(base) ?? 0) + row.count);
		groups.set(key, group);
	}

	return groups;
}

let cache: { at: number; canon: Map<string, string> } | null = null;

function getCanonicalIndex(): Map<string, string> {
	if (cache && Date.now() - cache.at < 300_000) return cache.canon;

	const groups = buildGroups();
	const canon = new Map<string, string>();

	for (const [key, group] of Array.from(groups.entries())) {
		const chosen = chooseCanonical(group);
		if (chosen) canon.set(key, chosen);
	}

	cache = { at: Date.now(), canon };
	return canon;
}

export function canonicalizeProject(
	raw: string | null | undefined,
): string | null {
	const base = normalizeProjectBase(raw);
	const key = projectKeyFromBase(base);
	if (!base || !key) return null;
	const canon = getCanonicalIndex().get(key);
	return canon ?? base;
}

export function normalizeProjectsInDb(): {
	updatedRows: number;
	groups: number;
} {
	if (!isDbOpen()) return { updatedRows: 0, groups: 0 };

	const groups = buildGroups();
	let updatedRows = 0;

	const db = getDatabase();
	const tx = db.transaction(() => {
		for (const group of Array.from(groups.values())) {
			const canonical = chooseCanonical(group);
			if (!canonical) continue;
			for (const raw of Array.from(group.rawVariants.keys())) {
				if (raw === canonical) continue;
				updatedRows += updateProjectName(raw, canonical);
			}
		}
	});

	tx();
	cache = null;

	if (updatedRows > 0) {
		logger.info("Normalized projects", { updatedRows, groups: groups.size });
	}

	return { updatedRows, groups: groups.size };
}

export function invalidateProjectCache(): void {
	cache = null;
}
