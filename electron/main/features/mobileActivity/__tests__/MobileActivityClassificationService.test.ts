import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ClassificationResult,
	MobileActivityDay,
} from "../../../../shared/types";

const mockRetrievalClassify = vi.hoisted(() => vi.fn());
const mockLocalIsAvailable = vi.hoisted(() => vi.fn());
const mockLocalClassify = vi.hoisted(() => vi.fn());
const mockCloudIsAvailable = vi.hoisted(() => vi.fn());
const mockCloudClassify = vi.hoisted(() => vi.fn());

vi.mock("../../../infra/settings", () => ({
	getSettings: () => ({
		apiKey: null,
		llmEnabled: false,
		cloudLlmModel: "",
		localLlmEnabled: false,
		localLlmBaseUrl: "",
		localLlmModel: "",
	}),
}));

vi.mock("../../../infra/log", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("../../ai", () => ({
	localBaselineProvider: {
		id: "local-baseline",
		isAvailable: vi.fn(async () => ({ available: true, reason: null })),
		classify: vi.fn(async () => null),
	},
	localRetrievalProvider: {
		id: "local-retrieval",
		isAvailable: vi.fn(async () => ({ available: true, reason: null })),
		classify: mockRetrievalClassify,
	},
	localOpenAiProvider: {
		id: "local-openai",
		isAvailable: mockLocalIsAvailable,
		classify: mockLocalClassify,
	},
	openRouterTextProvider: {
		id: "openrouter-text",
		isAvailable: mockCloudIsAvailable,
		classify: mockCloudClassify,
	},
}));

import { classifyImportedMobileActivityDay } from "../MobileActivityClassificationService";

function makeClassificationResult(
	overrides: Partial<ClassificationResult>,
): ClassificationResult {
	return {
		category: overrides.category ?? "Work",
		subcategories: overrides.subcategories ?? [],
		project: overrides.project ?? null,
		project_progress: overrides.project_progress ?? {
			shown: false,
			confidence: 0,
		},
		potential_progress: overrides.potential_progress ?? false,
		tags: overrides.tags ?? [],
		confidence: overrides.confidence ?? 0.9,
		caption: overrides.caption ?? "Focused work",
		tracked_addiction: overrides.tracked_addiction ?? {
			detected: false,
			name: null,
		},
		addiction_candidate: overrides.addiction_candidate ?? null,
		addiction_confidence: overrides.addiction_confidence ?? null,
		addiction_prompt: overrides.addiction_prompt ?? null,
	};
}

function makeDay(overrides: Partial<MobileActivityDay>): MobileActivityDay {
	return {
		deviceId: overrides.deviceId ?? "ios-1",
		deviceName: overrides.deviceName ?? "Personal iPhone",
		platform: overrides.platform ?? "ios",
		dayStartMs: overrides.dayStartMs ?? 1_774_738_800_000,
		buckets: overrides.buckets ?? [],
		syncedAt: overrides.syncedAt ?? Date.now(),
	};
}

describe("MobileActivityClassificationService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRetrievalClassify.mockResolvedValue(null);
		mockLocalIsAvailable.mockResolvedValue({ available: false, reason: "off" });
		mockLocalClassify.mockResolvedValue(null);
		mockCloudIsAvailable.mockResolvedValue({ available: false, reason: "off" });
		mockCloudClassify.mockResolvedValue(null);
	});

	it("reuses the same desktop classification for repeated imported buckets", async () => {
		mockRetrievalClassify.mockResolvedValue(
			makeClassificationResult({
				category: "Study",
				caption: "Reading Swift docs",
				confidence: 0.88,
			}),
		);

		const classified = await classifyImportedMobileActivityDay(
			makeDay({
				buckets: [
					{
						hour: 9,
						durationSeconds: 1800,
						category: "Unknown",
						appName: "Safari",
						appBundleId: "com.apple.mobilesafari",
						domain: "docs.swift.org",
						domains: [{ domain: "docs.swift.org", durationSeconds: 1800 }],
					},
					{
						hour: 10,
						durationSeconds: 1800,
						category: "Unknown",
						appName: "Safari",
						appBundleId: "com.apple.mobilesafari",
						domain: "docs.swift.org",
						domains: [{ domain: "docs.swift.org", durationSeconds: 1800 }],
					},
				],
			}),
		);

		expect(mockRetrievalClassify).toHaveBeenCalledTimes(1);
		expect(classified.buckets).toEqual([
			expect.objectContaining({
				category: "Study",
				caption: "Reading Swift docs",
				confidence: 0.88,
				classificationSource: "desktop.retrieval",
				domain: "docs.swift.org",
			}),
			expect.objectContaining({
				category: "Study",
				caption: "Reading Swift docs",
				confidence: 0.88,
				classificationSource: "desktop.retrieval",
				domain: "docs.swift.org",
			}),
		]);
	});

	it("falls back to desktop heuristics for browser buckets when providers cannot classify", async () => {
		const classified = await classifyImportedMobileActivityDay(
			makeDay({
				buckets: [
					{
						hour: 21,
						durationSeconds: 2400,
						category: "Unknown",
						appName: "Safari",
						appBundleId: "com.apple.mobilesafari",
						domain: "youtube.com",
						domains: [{ domain: "youtube.com", durationSeconds: 2400 }],
					},
				],
			}),
		);

		expect(classified.buckets[0]).toMatchObject({
			category: "Leisure",
			caption: "youtube.com",
			confidence: 0.72,
			classificationSource: "desktop.heuristic",
			domain: "youtube.com",
		});
	});
});
