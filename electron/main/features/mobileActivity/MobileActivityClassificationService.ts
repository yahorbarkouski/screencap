import type {
	AutomationCategory,
	MobileActivityBucketApp,
	MobileActivityBucketDomain,
	MobileActivityDay,
	MobileActivityHourBucket,
} from "../../../shared/types";
import { createLogger } from "../../infra/log";
import { getSettings } from "../../infra/settings";
import {
	type ClassificationInput,
	type ClassificationProviderContext,
	localBaselineProvider,
	localOpenAiProvider,
	localRetrievalProvider,
	openRouterTextProvider,
} from "../ai";
import type { ScreenContext } from "../llm/prompts";

const logger = createLogger({ scope: "MobileActivityClassification" });

type BucketClassification = {
	category: AutomationCategory;
	caption: string | null;
	confidence: number | null;
	source: string;
};

const MESSAGING_KEYWORDS = [
	"messages",
	"imessage",
	"whatsapp",
	"telegram",
	"signal",
	"discord",
	"messenger",
	"wechat",
	"line",
	"snapchat",
	"phone",
	"facetime",
];

const WORK_KEYWORDS = [
	"slack",
	"teams",
	"meet",
	"zoom",
	"gmail",
	"mail",
	"calendar",
	"notion",
	"figma",
	"github",
	"gitlab",
	"jira",
	"linear",
	"trello",
	"docs",
	"sheets",
	"excel",
	"word",
	"powerpoint",
	"xcode",
	"code",
	"cursor",
	"terminal",
	"warp",
];

const STUDY_KEYWORDS = [
	"anki",
	"udemy",
	"coursera",
	"edx",
	"khan",
	"kindle",
	"wikipedia",
	"notebooklm",
	"readwise",
];

const LEISURE_KEYWORDS = [
	"youtube",
	"netflix",
	"spotify",
	"music",
	"tiktok",
	"instagram",
	"reddit",
	"facebook",
	"x ",
	"x.com",
	"twitter",
	"twitch",
	"steam",
	"game",
];

const CHORES_KEYWORDS = [
	"amazon",
	"allegro",
	"uber",
	"bolt",
	"maps",
	"wallet",
	"bank",
	"banking",
	"revolut",
	"monzo",
	"food",
	"deliveroo",
	"doordash",
	"instacart",
	"booking",
	"airbnb",
	"settings",
	"app store",
];

const BROWSER_BUNDLE_KEYWORDS = [
	"safari",
	"chrome",
	"firefox",
	"arc",
	"brave",
	"edge",
	"opera",
	"duckduckgo",
];

function compact(value: string | null | undefined): string | null {
	const trimmed = (value ?? "").trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isBrowserBucket(bucket: MobileActivityHourBucket): boolean {
	const candidates = [
		bucket.appBundleId,
		bucket.appName,
		bucket.apps?.[0]?.bundleId ?? null,
		bucket.apps?.[0]?.name ?? null,
	];
	return candidates.some((value) => {
		const normalized = normalizeText(value);
		return BROWSER_BUNDLE_KEYWORDS.some((keyword) =>
			normalized.includes(keyword),
		);
	});
}

function summarizeApps(
	apps: MobileActivityBucketApp[] | null | undefined,
): string[] {
	return (apps ?? [])
		.slice()
		.sort((a, b) => b.durationSeconds - a.durationSeconds)
		.slice(0, 3)
		.map((app) => {
			const minutes = Math.max(1, Math.round(app.durationSeconds / 60));
			return `${app.name} (${minutes}m)`;
		});
}

function summarizeDomains(
	domains: MobileActivityBucketDomain[] | null | undefined,
): string[] {
	return (domains ?? [])
		.slice()
		.sort((a, b) => b.durationSeconds - a.durationSeconds)
		.slice(0, 3)
		.map((domain) => {
			const minutes = Math.max(1, Math.round(domain.durationSeconds / 60));
			return `${domain.domain} (${minutes}m)`;
		});
}

function preferredAppName(bucket: MobileActivityHourBucket): string | null {
	if (bucket.domain && isBrowserBucket(bucket)) return bucket.domain;
	return (
		compact(bucket.appName) ??
		compact(bucket.apps?.[0]?.name ?? null) ??
		compact(bucket.domain)
	);
}

function preferredBundleId(bucket: MobileActivityHourBucket): string | null {
	return (
		compact(bucket.appBundleId) ?? compact(bucket.apps?.[0]?.bundleId ?? null)
	);
}

function preferredDomain(bucket: MobileActivityHourBucket): string | null {
	return compact(bucket.domain) ?? compact(bucket.domains?.[0]?.domain ?? null);
}

function buildCaption(bucket: MobileActivityHourBucket): string {
	const primary = preferredAppName(bucket);
	if (primary) return primary;
	if (bucket.rawCategory) return bucket.rawCategory;
	return "iPhone activity";
}

function buildScreenContext(bucket: MobileActivityHourBucket): ScreenContext {
	const appSummary = summarizeApps(bucket.apps);
	const domainSummary = summarizeDomains(bucket.domains);
	const rawParts = [
		`Imported iPhone Screen Time hour ${String(bucket.hour).padStart(2, "0")}:00`,
		bucket.rawCategory ? `Screen Time category: ${bucket.rawCategory}` : null,
		appSummary.length > 0 ? `Top apps: ${appSummary.join(", ")}` : null,
		domainSummary.length > 0 ? `Top sites: ${domainSummary.join(", ")}` : null,
	]
		.filter(Boolean)
		.join("\n");

	return {
		appBundleId: preferredBundleId(bucket),
		appName: compact(bucket.appName) ?? compact(bucket.apps?.[0]?.name ?? null),
		windowTitle: bucket.rawCategory
			? `Screen Time: ${bucket.rawCategory}`
			: null,
		urlHost: preferredDomain(bucket),
		contentKind: "mobile_activity",
		contentTitle:
			appSummary.length > 0
				? `iPhone usage: ${appSummary.join(", ")}`
				: domainSummary.length > 0
					? `iPhone browsing: ${domainSummary.join(", ")}`
					: "Imported iPhone activity",
		userCaption: rawParts,
		selectedProject: null,
	};
}

function buildProviderContext(): ClassificationProviderContext {
	const settings = getSettings();
	return {
		mode: settings.llmEnabled ? "hybrid" : "off",
		apiKey: settings.apiKey,
		allowVisionUploads: false,
		cloudModel: settings.cloudLlmModel.trim() || null,
		localBaseUrl: settings.localLlmEnabled
			? settings.localLlmBaseUrl.trim() || null
			: null,
		localModel: settings.localLlmEnabled
			? settings.localLlmModel.trim() || null
			: null,
	};
}

function keywordCategory(
	bucket: MobileActivityHourBucket,
): AutomationCategory | null {
	const haystacks = [
		preferredAppName(bucket),
		preferredBundleId(bucket),
		preferredDomain(bucket),
		bucket.rawCategory,
		...(bucket.apps ?? []).map((app) => app.name),
		...(bucket.domains ?? []).map((domain) => domain.domain),
	]
		.map(normalizeText)
		.filter(Boolean);

	const matches = (keywords: string[]) =>
		haystacks.some((text) =>
			keywords.some((keyword) => text.includes(keyword)),
		);

	if (matches(MESSAGING_KEYWORDS)) return "Social";
	if (matches(WORK_KEYWORDS)) return "Work";
	if (matches(STUDY_KEYWORDS)) return "Study";
	if (matches(CHORES_KEYWORDS)) return "Chores";
	if (matches(LEISURE_KEYWORDS)) return "Leisure";
	return null;
}

function classifyHeuristically(
	bucket: MobileActivityHourBucket,
): BucketClassification {
	const keywordMatch = keywordCategory(bucket);
	if (keywordMatch) {
		return {
			category: keywordMatch,
			caption: buildCaption(bucket),
			confidence: 0.72,
			source: "desktop.heuristic",
		};
	}

	if (bucket.category !== "Unknown") {
		return {
			category: bucket.category,
			caption: buildCaption(bucket),
			confidence: 0.56,
			source: "screen_time",
		};
	}

	return {
		category: "Unknown",
		caption: buildCaption(bucket),
		confidence: 0,
		source: "desktop.baseline",
	};
}

function providerSource(providerId: string): string {
	if (providerId === localRetrievalProvider.id) return "desktop.retrieval";
	if (providerId === localBaselineProvider.id) return "desktop.baseline";
	return "desktop.llm";
}

async function classifyBucket(
	bucket: MobileActivityHourBucket,
	ctx: ClassificationProviderContext,
): Promise<BucketClassification> {
	const input: ClassificationInput = {
		imageBase64: null,
		ocrText: null,
		context: buildScreenContext(bucket),
	};

	const retrieval = await localRetrievalProvider.classify(input, ctx);
	if (retrieval) {
		return {
			category: retrieval.category,
			caption: retrieval.caption,
			confidence: retrieval.confidence,
			source: providerSource(localRetrievalProvider.id),
		};
	}

	if (ctx.mode !== "off") {
		const localAvailability = await localOpenAiProvider.isAvailable(ctx);
		if (localAvailability.available) {
			const local = await localOpenAiProvider.classify(input, ctx);
			if (local) {
				return {
					category: local.category,
					caption: local.caption,
					confidence: local.confidence,
					source: providerSource(localOpenAiProvider.id),
				};
			}
		}

		const cloudAvailability = await openRouterTextProvider.isAvailable(ctx);
		if (cloudAvailability.available) {
			const cloud = await openRouterTextProvider.classify(input, ctx);
			if (cloud) {
				return {
					category: cloud.category,
					caption: cloud.caption,
					confidence: cloud.confidence,
					source: providerSource(openRouterTextProvider.id),
				};
			}
		}
	}

	return classifyHeuristically(bucket);
}

function classificationKey(bucket: MobileActivityHourBucket): string {
	const apps = (bucket.apps ?? [])
		.slice()
		.sort((a, b) => b.durationSeconds - a.durationSeconds)
		.map((app) => `${app.bundleId ?? ""}:${app.name}:${app.durationSeconds}`)
		.join("|");
	const domains = (bucket.domains ?? [])
		.slice()
		.sort((a, b) => b.durationSeconds - a.durationSeconds)
		.map((domain) => `${domain.domain}:${domain.durationSeconds}`)
		.join("|");
	return JSON.stringify({
		appName: bucket.appName ?? null,
		appBundleId: bucket.appBundleId ?? null,
		domain: bucket.domain ?? null,
		rawCategory: bucket.rawCategory ?? null,
		apps,
		domains,
	});
}

export async function classifyImportedMobileActivityDay(
	day: MobileActivityDay,
): Promise<MobileActivityDay> {
	const ctx = buildProviderContext();
	const cache = new Map<string, BucketClassification>();
	const buckets: MobileActivityHourBucket[] = [];

	for (const bucket of day.buckets) {
		if (bucket.durationSeconds <= 0) {
			buckets.push(bucket);
			continue;
		}

		const normalizedBucket: MobileActivityHourBucket = {
			...bucket,
			appName:
				compact(bucket.appName) ?? compact(bucket.apps?.[0]?.name ?? null),
			appBundleId: preferredBundleId(bucket),
			domain: preferredDomain(bucket),
			apps: bucket.apps ?? null,
			domains: bucket.domains ?? null,
			rawCategory: compact(bucket.rawCategory) ?? compact(bucket.category),
		};
		const key = classificationKey(normalizedBucket);
		let classified = cache.get(key);
		if (!classified) {
			try {
				classified = await classifyBucket(normalizedBucket, ctx);
			} catch (error) {
				logger.warn("Failed to classify imported mobile bucket", {
					hour: normalizedBucket.hour,
					appName: normalizedBucket.appName,
					domain: normalizedBucket.domain,
					error: String(error),
				});
				classified = classifyHeuristically(normalizedBucket);
			}
			cache.set(key, classified);
		}

		buckets.push({
			...normalizedBucket,
			category: classified.category,
			caption: classified.caption,
			confidence: classified.confidence,
			classificationSource: classified.source,
		});
	}

	return { ...day, buckets };
}
