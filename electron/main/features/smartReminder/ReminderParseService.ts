import { createLogger } from "../../infra/log";
import { getApiKey, isLlmEnabled } from "../../infra/settings";
import { callOpenRouter } from "../llm/OpenRouterClient";
import { buildReminderParsePrompt, type ReminderContext } from "../llm/prompts";
import { type ReminderParse, ReminderParseSchema } from "../llm/schemas";

const logger = createLogger({ scope: "ReminderParse" });

const REMINDER_MODEL = "anthropic/claude-sonnet-4.5";

export interface ParsedReminder {
	title: string;
	body: string | null;
	isReminder: boolean;
	remindAt: number | null;
}

export async function parseReminderWithAI(
	userText: string,
	ocrText: string | null,
	context: {
		appBundleId: string | null;
		windowTitle: string | null;
		urlHost: string | null;
		contentKind: string | null;
	},
	imageBase64?: string | null,
): Promise<ParsedReminder> {
	const apiKey = getApiKey();
	const llmEnabled = isLlmEnabled();

	if (!apiKey || !llmEnabled) {
		throw new Error("LLM not available for reminder parsing");
	}

	const now = new Date();
	const reminderContext: ReminderContext = {
		userText,
		ocrText,
		appBundleId: context.appBundleId,
		windowTitle: context.windowTitle,
		urlHost: context.urlHost,
		contentKind: context.contentKind,
		hasImage: Boolean(imageBase64),
		currentDateTime: now.toISOString(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	};

	const prompt = buildReminderParsePrompt(reminderContext);

	try {
		const userContent = imageBase64
			? [
					{
						type: "image_url",
						image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
					},
					{ type: "text", text: userText },
				]
			: userText;

		const result = await callOpenRouter<ReminderParse>(
			[
				{ role: "system", content: prompt },
				{ role: "user", content: userContent },
			],
			ReminderParseSchema,
			{ maxTokens: 2000, temperature: 0.3, model: REMINDER_MODEL },
		);

		let remindAt: number | null = null;
		if (result.isReminder && result.remindAt) {
			try {
				remindAt = new Date(result.remindAt).getTime();
				if (Number.isNaN(remindAt)) {
					remindAt = null;
				}
			} catch {
				remindAt = null;
			}
		}

		return {
			title: result.title.slice(0, 200),
			body: result.body,
			isReminder: result.isReminder,
			remindAt,
		};
	} catch (error) {
		logger.error("AI parsing failed", { error: String(error) });
		throw error;
	}
}
