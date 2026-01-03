import { z } from "zod";
import type {
	ClassificationResult,
	LLMTestResult,
} from "../../../../shared/types";
import { getMemories } from "../../../infra/db/repositories/MemoryRepository";
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
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_TEST_TIMEOUT_MS = 15_000;

type OpenAiChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
};

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

function buildChatCompletionsUrl(baseUrl: string): string {
	const base = normalizeBaseUrl(baseUrl);
	if (base.endsWith("/chat/completions")) return base;
	return `${base}/chat/completions`;
}

function firstJsonObject(text: string): string {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error("No JSON found in response");
	return match[0];
}

async function callLocalOpenAi<T>(
	params: {
		baseUrl: string;
		model: string;
		messages: unknown[];
		maxTokens?: number;
		temperature?: number;
		timeoutMs?: number;
	},
	schema: z.ZodType<T>,
): Promise<T> {
	const url = buildChatCompletionsUrl(params.baseUrl);
	const body: Record<string, unknown> = {
		model: params.model,
		messages: params.messages,
	};
	if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
	if (params.temperature !== undefined) body.temperature = params.temperature;

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Local OpenAI error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as OpenAiChatCompletionResponse;
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new Error("No response from local model");

	const parsed = JSON.parse(firstJsonObject(content));
	return schema.parse(parsed);
}

export async function testLocalOpenAiConnection(input: {
	baseUrl: string;
	model: string;
}): Promise<LLMTestResult> {
	const PingSchema = z.object({ ok: z.literal(true) });

	try {
		await callLocalOpenAi(
			{
				baseUrl: input.baseUrl,
				model: input.model,
				messages: [
					{
						role: "system",
						content: 'Return ONLY valid JSON: {"ok": true}',
					},
					{ role: "user", content: "ping" },
				],
				maxTokens: 20,
				temperature: 0,
				timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
			},
			PingSchema,
		);
		return { success: true };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

function normalizeProjectProgress(stage1: ClassificationStage1): {
	shown: boolean;
	confidence: number;
} {
	if (!stage1.project || !stage1.project_progress.shown) {
		return { shown: false, confidence: 0 };
	}
	return { shown: true, confidence: stage1.project_progress.confidence };
}

export const localOpenAiProvider: ClassificationProvider = {
	id: "local.http",

	async isAvailable(ctx): Promise<ProviderAvailability> {
		if (ctx.mode === "off")
			return { available: false, reason: "AI is disabled" };
		if (ctx.mode === "cloud")
			return { available: false, reason: "Local providers disabled" };
		if (!ctx.localBaseUrl)
			return { available: false, reason: "No local base URL configured" };
		if (!ctx.localModel)
			return { available: false, reason: "No local model configured" };
		return { available: true, reason: null };
	},

	async classify(input, ctx): Promise<ClassificationResult | null> {
		if (!ctx.localBaseUrl || !ctx.localModel) return null;

		const memories = getMemories();
		const addictions = buildAddictionOptions(memories);
		const ocrText = (input.ocrText ?? "").trim().slice(0, OCR_MAX_CHARS);
		if (!input.context && ocrText.length === 0) return null;

		const stage1 = await callLocalOpenAi<ClassificationStage1>(
			{
				baseUrl: ctx.localBaseUrl,
				model: ctx.localModel,
				messages: [
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
							{ ocr_text: ocrText.length > 0 ? ocrText : null },
							null,
							2,
						),
					},
				],
				maxTokens: 900,
				temperature: 0,
			},
			ClassificationStage1Schema,
		);

		if (stage1.confidence < FALLBACK_CONFIDENCE_THRESHOLD) {
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
