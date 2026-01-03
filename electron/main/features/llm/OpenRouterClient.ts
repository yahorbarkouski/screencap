import type { z } from "zod";
import { createLogger } from "../../infra/log";
import { getApiKey } from "../../infra/settings";

const logger = createLogger({ scope: "OpenRouterClient" });

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_TEST_TIMEOUT_MS = 15_000;

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

	const model = options?.model?.trim() || DEFAULT_MODEL;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const body: Record<string, unknown> = {
		model,
		messages,
		reasoning_effort: "low",
	};

	if (options?.maxTokens !== undefined) {
		body.max_tokens = options.maxTokens;
	}

	if (options?.temperature !== undefined) {
		body.temperature = options.temperature;
	}

	let response: Response;
	try {
		response = await fetchWithTimeout(
			OPENROUTER_API_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"HTTP-Referer": "https://screencap.app",
					"X-Title": "Screencap",
				},
				body: JSON.stringify(body),
			},
			timeoutMs,
		);
	} catch (error) {
		recordCall({
			timestamp: Date.now(),
			kind: "json",
			model: String(body.model ?? DEFAULT_MODEL),
			status: 0,
		});
		throw error;
	}

	recordCall({
		timestamp: Date.now(),
		kind: "json",
		model: String(body.model ?? DEFAULT_MODEL),
		status: response.status,
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error("OpenRouter API error:", { status: response.status, error });
		throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
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

	const model = options?.model?.trim() || DEFAULT_MODEL;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const body: Record<string, unknown> = {
		model,
		messages,
		reasoning_effort: "low",
	};

	if (options?.maxTokens !== undefined) {
		body.max_tokens = options.maxTokens;
	}

	if (options?.temperature !== undefined) {
		body.temperature = options.temperature;
	}

	let response: Response;
	try {
		response = await fetchWithTimeout(
			OPENROUTER_API_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"HTTP-Referer": "https://screencap.app",
					"X-Title": "Screencap",
				},
				body: JSON.stringify(body),
			},
			timeoutMs,
		);
	} catch (error) {
		recordCall({
			timestamp: Date.now(),
			kind: "raw",
			model: String(body.model ?? DEFAULT_MODEL),
			status: 0,
		});
		throw error;
	}

	recordCall({
		timestamp: Date.now(),
		kind: "raw",
		model: String(body.model ?? DEFAULT_MODEL),
		status: response.status,
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error("OpenRouter API error:", { status: response.status, error });
		throw new Error(`OpenRouter API error: ${response.status}`);
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

	const selectedModel = model?.trim() || DEFAULT_MODEL;

	try {
		const response = await fetchWithTimeout(
			OPENROUTER_API_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"HTTP-Referer": "https://screencap.app",
					"X-Title": "Screencap",
				},
				body: JSON.stringify({
					model: selectedModel,
					messages: [{ role: "user", content: "Hello" }],
				}),
			},
			DEFAULT_TEST_TIMEOUT_MS,
		);

		recordCall({
			timestamp: Date.now(),
			kind: "test",
			model: selectedModel,
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
