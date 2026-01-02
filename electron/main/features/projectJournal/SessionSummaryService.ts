import type { GitCommit, RepoWorkSession } from "../../../shared/types";
import {
	getWorkSessionById,
	updateWorkSessionById,
} from "../../infra/db/repositories/RepoWorkSessionRepository";
import { createLogger } from "../../infra/log";
import { getApiKey } from "../../infra/settings";
import { getSettings } from "../../infra/settings/SettingsStore";

const logger = createLogger({ scope: "SessionSummaryService" });

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SESSION_SUMMARY_MODEL = "openai/gpt-5-nano-2025-08-07";

function repoLabel(repoRoot: string): string {
	const parts = repoRoot.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? repoRoot;
}

function buildSystemPrompt(): string {
	return `You are a concise technical assistant. Summarize a coding work session in 1-2 short sentences.
Focus on WHAT was done (files touched, likely purpose). Be specific but brief.
Output plain text only, no markdown, no bullet points.`;
}

function buildUserPayload(
	session: RepoWorkSession,
	commits: GitCommit[],
): string {
	const durationMinutes = Math.round(
		(session.endAt - session.startAt) / 60_000,
	);
	const sessionCommits = commits
		.filter(
			(c) => c.timestamp >= session.startAt && c.timestamp <= session.endAt,
		)
		.slice(0, 20);

	return JSON.stringify({
		repo: repoLabel(session.repoRoot),
		branch: session.branch,
		durationMinutes,
		insertions: session.maxInsertions,
		deletions: session.maxDeletions,
		files: session.files.slice(0, 30),
		commits: sessionCommits.map((c) => ({
			subject: c.subject,
			files: c.files.slice(0, 10),
		})),
	});
}

type OpenRouterChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
};

async function callNanoModel(messages: unknown[]): Promise<string> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("API key not configured");
	}

	const response = await fetch(OPENROUTER_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"HTTP-Referer": "https://screencap.app",
			"X-Title": "Screencap",
		},
		body: JSON.stringify({
			model: SESSION_SUMMARY_MODEL,
			messages,
			max_tokens: 150,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error("Session summary API error:", {
			status: response.status,
			error,
		});
		throw new Error(`API error: ${response.status}`);
	}

	const data = (await response.json()) as OpenRouterChatCompletionResponse;
	return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function generateSessionSummary(
	sessionId: string,
	commits: GitCommit[],
): Promise<string | null> {
	const settings = getSettings();
	if (!settings.sessionSummaryEnabled) {
		return null;
	}

	const session = getWorkSessionById(sessionId);
	if (!session) {
		logger.warn("Session not found", { sessionId });
		return null;
	}

	if (session.summary) {
		return session.summary;
	}

	if (session.isOpen) {
		return null;
	}

	if (
		session.files.length === 0 &&
		session.maxInsertions === 0 &&
		session.maxDeletions === 0
	) {
		return null;
	}

	try {
		const summary = await callNanoModel([
			{ role: "system", content: buildSystemPrompt() },
			{ role: "user", content: buildUserPayload(session, commits) },
		]);

		if (summary) {
			updateWorkSessionById(sessionId, { summary });
			logger.info("Generated session summary", { sessionId, summary });
		}

		return summary || null;
	} catch (error) {
		logger.error("Failed to generate session summary", { sessionId, error });
		return null;
	}
}

export async function getOrGenerateSessionSummary(
	sessionId: string,
	commits: GitCommit[],
): Promise<string | null> {
	const session = getWorkSessionById(sessionId);
	if (!session) return null;

	if (session.summary) {
		return session.summary;
	}

	return generateSessionSummary(sessionId, commits);
}
