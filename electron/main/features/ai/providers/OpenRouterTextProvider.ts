import type { ClassificationResult } from "../../../../shared/types";
import { getMemories } from "../../../infra/db/repositories/MemoryRepository";
import { callOpenRouter } from "../../llm/OpenRouterClient";
import {
	buildAddictionOptions,
	buildSystemPromptStage1TextOnly,
} from "../../llm/prompts";
import {
	type ClassificationStage1,
	ClassificationStage1Schema,
} from "../../llm/schemas";
import type { ClassificationProvider, ProviderAvailability } from "../types";

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

function shouldFallbackToVision(input: {
	imageBase64: string | null;
	allowVisionUploads: boolean;
	stage1: ClassificationStage1;
}): boolean {
	if (!input.allowVisionUploads) return false;
	if (!input.imageBase64) return false;
	if (input.stage1.confidence < FALLBACK_CONFIDENCE_THRESHOLD) return true;
	const hasAddictionCandidates =
		input.stage1.addiction_triage.tracking_enabled &&
		input.stage1.addiction_triage.candidates.length > 0;
	if (hasAddictionCandidates) return true;
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
		if (!input.context && ocrText.length === 0) {
			return null;
		}

		const stage1 = await callOpenRouter<ClassificationStage1>(
			[
				{
					role: "system",
					content: buildSystemPromptStage1TextOnly(
						memories,
						addictions,
						input.context,
					),
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

		if (
			shouldFallbackToVision({
				stage1,
				allowVisionUploads: ctx.allowVisionUploads,
				imageBase64: input.imageBase64,
			})
		) {
			return null;
		}

		return {
			category: stage1.category,
			subcategories: stage1.subcategories,
			project: stage1.project,
			project_progress: normalizeProjectProgress(stage1),
			tags: stage1.tags,
			confidence: stage1.confidence,
			caption: stage1.caption,
			tracked_addiction: { detected: false, name: null },
			addiction_candidate: null,
			addiction_confidence: null,
			addiction_prompt: null,
		};
	},
};
