import type { ClassificationResult } from "../../../../shared/types";
import { getMemories } from "../../../infra/db/repositories/MemoryRepository";
import { createLogger } from "../../../infra/log";
import { callOpenRouter } from "../../llm/OpenRouterClient";
import {
	type AddictionOption,
	buildAddictionOptions,
	buildSystemPromptStage1TextOnly,
} from "../../llm/prompts";
import {
	type ClassificationStage1,
	ClassificationStage1Schema,
} from "../../llm/schemas";
import type { ClassificationProvider, ProviderAvailability } from "../types";

const logger = createLogger({ scope: "OpenRouterTextProvider" });

const OCR_MAX_CHARS = 12_000;
const FALLBACK_CONFIDENCE_THRESHOLD = 0.55;

function normalizeProjectProgress(stage1: ClassificationStage1): {
	shown: boolean;
	confidence: number;
} {
	if (!stage1.project || !stage1.project_progress.shown) {
		return { shown: false, confidence: 0 };
	}
	return { shown: true, confidence: stage1.project_progress.confidence };
}

function extractAddictionCandidate(
	stage1: ClassificationStage1,
	addictions: AddictionOption[],
): {
	name: string;
	confidence: number;
	prompt: string | null;
} | null {
	if (!stage1.addiction_triage.tracking_enabled) return null;
	if (stage1.addiction_triage.candidates.length === 0) return null;

	const sorted = [...stage1.addiction_triage.candidates].sort(
		(a, b) => b.likelihood - a.likelihood,
	);
	const top = sorted[0];
	if (!top) return null;

	const matched = addictions.find((a) => a.id === top.addiction_id);
	if (!matched) return null;

	return {
		name: matched.name,
		confidence: top.likelihood,
		prompt: top.rationale || null,
	};
}

function shouldFallbackToVision(input: {
	imageBase64: string | null;
	allowVisionUploads: boolean;
	hasOcrText: boolean;
	hasAddictions: boolean;
	stage1: ClassificationStage1;
}): boolean {
	if (!input.allowVisionUploads) return false;
	if (!input.imageBase64) return false;
	if (input.stage1.confidence < FALLBACK_CONFIDENCE_THRESHOLD) return true;
	const hasAddictionCandidates =
		input.stage1.addiction_triage.tracking_enabled &&
		input.stage1.addiction_triage.candidates.length > 0;
	if (hasAddictionCandidates) return true;
	if (!input.hasOcrText && input.hasAddictions) return true;
	return false;
}

export const openRouterTextProvider: ClassificationProvider = {
	id: "cloud.openrouter.text",

	async isAvailable(ctx): Promise<ProviderAvailability> {
		if (ctx.mode === "off")
			return { available: false, reason: "AI is disabled" };
		if (ctx.mode === "local")
			return { available: false, reason: "Cloud providers disabled" };
		if (!ctx.apiKey)
			return { available: false, reason: "No API key configured" };
		return { available: true, reason: null };
	},

	async classify(input, ctx): Promise<ClassificationResult | null> {
		const memories = getMemories();
		const addictions = buildAddictionOptions(memories);

		const ocrText = (input.ocrText ?? "").trim().slice(0, OCR_MAX_CHARS);

		logger.info("Text provider starting classification", {
			hasContext: !!input.context,
			hasOcrText: ocrText.length > 0,
			ocrTextLength: ocrText.length,
			hasImage: !!input.imageBase64,
			allowVisionUploads: ctx.allowVisionUploads,
			addictionsCount: addictions.length,
			addictions: addictions.map((a) => ({ id: a.id, name: a.name })),
		});

		if (!input.context && ocrText.length === 0) {
			logger.info("Text provider: no context and no OCR, returning null");
			return null;
		}

		const systemPrompt = buildSystemPromptStage1TextOnly(
			memories,
			addictions,
			input.context,
		);
		logger.debug("Text provider system prompt", {
			promptLength: systemPrompt.length,
			prompt: systemPrompt,
		});

		const stage1 = await callOpenRouter<ClassificationStage1>(
			[
				{
					role: "system",
					content: systemPrompt,
				},
				{
					role: "user",
					content: JSON.stringify(
						{
							ocr_text: ocrText.length > 0 ? ocrText : null,
						},
						null,
						2,
					),
				},
			],
			ClassificationStage1Schema,
			{ maxTokens: 900, temperature: 0, model: ctx.cloudModel ?? undefined },
		);

		logger.info("Text provider stage1 result", {
			category: stage1.category,
			confidence: stage1.confidence,
			addictionTriage: {
				trackingEnabled: stage1.addiction_triage.tracking_enabled,
				potentiallyAddictive: stage1.addiction_triage.potentially_addictive,
				candidatesCount: stage1.addiction_triage.candidates.length,
				candidates: stage1.addiction_triage.candidates,
			},
		});

		const fallbackCheck = {
			stage1Confidence: stage1.confidence,
			confidenceThreshold: FALLBACK_CONFIDENCE_THRESHOLD,
			belowThreshold: stage1.confidence < FALLBACK_CONFIDENCE_THRESHOLD,
			allowVisionUploads: ctx.allowVisionUploads,
			hasImage: !!input.imageBase64,
			hasOcrText: ocrText.length > 0,
			hasAddictions: addictions.length > 0,
			hasAddictionCandidates:
				stage1.addiction_triage.tracking_enabled &&
				stage1.addiction_triage.candidates.length > 0,
		};
		logger.info("Text provider fallback check", fallbackCheck);

		if (
			shouldFallbackToVision({
				stage1,
				allowVisionUploads: ctx.allowVisionUploads,
				imageBase64: input.imageBase64,
				hasOcrText: ocrText.length > 0,
				hasAddictions: addictions.length > 0,
			})
		) {
			logger.info(
				"Text provider falling back to vision for addiction detection",
			);
			return null;
		}

		const projectProgress = normalizeProjectProgress(stage1);
		const potentialProgress =
			!!stage1.project && !projectProgress.shown && stage1.potential_progress;

		const addictionCandidate = extractAddictionCandidate(stage1, addictions);

		logger.info("Text provider extracted addiction candidate", {
			candidate: addictionCandidate,
			rawCandidates: stage1.addiction_triage.candidates.map((c) => ({
				addictionId: c.addiction_id,
				likelihood: c.likelihood,
			})),
		});

		const result = {
			category: stage1.category,
			subcategories: stage1.subcategories,
			project: stage1.project,
			project_progress: projectProgress,
			potential_progress: potentialProgress,
			tags: stage1.tags,
			confidence: stage1.confidence,
			caption: stage1.caption,
			tracked_addiction: { detected: false, name: null },
			addiction_candidate: addictionCandidate?.name ?? null,
			addiction_confidence: addictionCandidate?.confidence ?? null,
			addiction_prompt: addictionCandidate?.prompt ?? null,
		};

		logger.info("Text provider returning result", {
			category: result.category,
			addictionCandidate: result.addiction_candidate,
			addictionConfidence: result.addiction_confidence,
		});

		return result;
	},
};
