import type { z } from "zod";
import { createLogger } from "../../infra/log";
import { getApiKey } from "../../infra/settings";

const logger = createLogger({ scope: "LLMClient" });

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5";
const DEFAULT_OPENAI_MODEL = "gpt-5";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_TEST_TIMEOUT_MS = 15_000;

function isOpenRouterKey(apiKey: string): boolean {
	return apiKey.startsWith("sk-or-");
}

type ApiConfig = {
	url: string;
	model: string;
	headers: Record<string, string>;
	supportsReasoningEffort: boolean;
	supportsTemperature: boolean;
	maxTokensKey: "max_tokens" | "max_completion_tokens";
};

function isReasoningModel(model: string): boolean {
	const m = model.toLowerCase();
	return m.includes("o1") || m.includes("o3") || m.startsWith("gpt-5");
}

function getApiConfig(apiKey: string, model?: string): ApiConfig {
	if (isOpenRouterKey(apiKey)) {
		return {
			url: OPENROUTER_API_URL,
			model: model?.trim() || DEFAULT_OPENROUTER_MODEL,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"HTTP-Referer": "https://screencap.app",
				"X-Title": "Screencap",
			},
			supportsReasoningEffort: true,
			supportsTemperature: true,
			maxTokensKey: "max_tokens",
		};
	}

	const normalizedModel =
		model?.trim().replace(/^openai\//, "") || DEFAULT_OPENAI_MODEL;
	const reasoning = isReasoningModel(normalizedModel);
	return {
		url: OPENAI_API_URL,
		model: normalizedModel,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		supportsReasoningEffort: false,
		supportsTemperature: !reasoning,
		maxTokensKey: reasoning ? "max_completion_tokens" : "max_tokens",
	};
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

export type OpenRouterCallRecord = {
	timestamp: number;
	kind: "json" | "raw" | "test";
	model: string;
	status: number;
};

let callRecords: OpenRouterCallRecord[] = [];

function recordCall(record: OpenRouterCallRecord): void {
	callRecords.push(record);
	if (callRecords.length > 5000) {
		callRecords = callRecords.slice(callRecords.length - 5000);
	}
}

export function resetOpenRouterCallRecords(): void {
	callRecords = [];
}

export function getOpenRouterCallRecords(): readonly OpenRouterCallRecord[] {
	return callRecords;
}

export interface OpenRouterOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	timeoutMs?: number;
}

type OpenRouterChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
};

function firstJsonObject(text: string): string {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error("No JSON found in response");
	return match[0];
}

export async function callOpenRouter<T>(
	messages: unknown[],
	schema: z.ZodType<T>,
	options?: OpenRouterOptions,
): Promise<T> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("API key not configured");
	}

	const config = getApiConfig(apiKey, options?.model);
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const body: Record<string, unknown> = {
		model: config.model,
		messages,
	};

	if (config.supportsReasoningEffort) {
		body.reasoning_effort = "low";
	}

	if (options?.maxTokens !== undefined) {
		body[config.maxTokensKey] = options.maxTokens;
	}

	if (options?.temperature !== undefined && config.supportsTemperature) {
		body.temperature = options.temperature;
	}

	let response: Response;
	try {
		response = await fetchWithTimeout(
			config.url,
			{
				method: "POST",
				headers: config.headers,
				body: JSON.stringify(body),
			},
			timeoutMs,
		);
	} catch (error) {
		recordCall({
			timestamp: Date.now(),
			kind: "json",
			model: config.model,
			status: 0,
		});
		throw error;
	}

	recordCall({
		timestamp: Date.now(),
		kind: "json",
		model: config.model,
		status: response.status,
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error("LLM API error:", { status: response.status, error });
		throw new Error(`LLM API error: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as OpenRouterChatCompletionResponse;
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new Error("No response from LLM");

	const parsed = JSON.parse(firstJsonObject(content));
	return schema.parse(parsed);
}

export async function callOpenRouterRaw(
	messages: unknown[],
	options?: OpenRouterOptions,
): Promise<string> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("API key not configured");
	}

	const config = getApiConfig(apiKey, options?.model);
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const body: Record<string, unknown> = {
		model: config.model,
		messages,
	};

	if (config.supportsReasoningEffort) {
		body.reasoning_effort = "low";
	}

	if (options?.maxTokens !== undefined) {
		body[config.maxTokensKey] = options.maxTokens;
	}

	if (options?.temperature !== undefined && config.supportsTemperature) {
		body.temperature = options.temperature;
	}

	let response: Response;
	try {
		response = await fetchWithTimeout(
			config.url,
			{
				method: "POST",
				headers: config.headers,
				body: JSON.stringify(body),
			},
			timeoutMs,
		);
	} catch (error) {
		recordCall({
			timestamp: Date.now(),
			kind: "raw",
			model: config.model,
			status: 0,
		});
		throw error;
	}

	recordCall({
		timestamp: Date.now(),
		kind: "raw",
		model: config.model,
		status: response.status,
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error("LLM API error:", { status: response.status, error });
		throw new Error(`LLM API error: ${response.status}`);
	}

	const data = (await response.json()) as OpenRouterChatCompletionResponse;
	return data.choices?.[0]?.message?.content || "";
}

export async function testConnection(model?: string): Promise<{
	success: boolean;
	error?: string;
}> {
	const apiKey = getApiKey();
	if (!apiKey) {
		return { success: false, error: "API key not configured" };
	}

	const config = getApiConfig(apiKey, model);

	try {
		const response = await fetchWithTimeout(
			config.url,
			{
				method: "POST",
				headers: config.headers,
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: "user", content: "Hello" }],
				}),
			},
			DEFAULT_TEST_TIMEOUT_MS,
		);

		recordCall({
			timestamp: Date.now(),
			kind: "test",
			model: config.model,
			status: response.status,
		});

		if (response.ok) {
			return { success: true };
		} else {
			const error = await response.text();
			return { success: false, error };
		}
	} catch (error) {
		return { success: false, error: String(error) };
	}
}
