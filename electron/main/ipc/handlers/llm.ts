import { IpcChannels } from "../../../shared/ipc";
import type { EventSummary, PeriodType } from "../../../shared/types";
import {
	type ClassificationProviderContext,
	createAiRouter,
	localOpenAiProvider,
	openRouterTextProvider,
	openRouterVisionProvider,
	testLocalOpenAiConnection,
} from "../../features/ai";
import { generateStory, testConnection } from "../../features/llm";
import { recognizeTextFromWebpBase64 } from "../../features/ocr";
import { getSettings } from "../../infra/settings";
import { secureHandle } from "../secure";
import {
	ipcLlmClassifyArgs,
	ipcLlmGenerateStoryArgs,
	ipcLlmTestConnectionArgs,
	ipcNoArgs,
} from "../validation";

const aiRouter = createAiRouter([
	localOpenAiProvider,
	openRouterTextProvider,
	openRouterVisionProvider,
]);

function buildProviderContext(): ClassificationProviderContext {
	const settings = getSettings();
	const localBaseUrl = settings.localLlmEnabled
		? settings.localLlmBaseUrl.trim() || null
		: null;
	const localModel = settings.localLlmEnabled
		? settings.localLlmModel.trim() || null
		: null;
	const cloudModel = settings.cloudLlmModel.trim() || null;

	return {
		mode: settings.llmEnabled ? "hybrid" : "off",
		apiKey: settings.apiKey,
		allowVisionUploads: settings.allowVisionUploads,
		cloudModel,
		localBaseUrl,
		localModel,
	};
}

function buildProviderOrder(ctx: ClassificationProviderContext): string[] {
	const order: string[] = [];
	order.push("local.retrieval");
	if (ctx.localBaseUrl && ctx.localModel) {
		order.push(localOpenAiProvider.id);
	}
	if (ctx.apiKey) {
		order.push(openRouterTextProvider.id);
		if (ctx.allowVisionUploads) order.push(openRouterVisionProvider.id);
	}
	order.push("local.baseline");
	return order;
}

export function registerLLMHandlers(): void {
	secureHandle(
		IpcChannels.LLM.Classify,
		ipcLlmClassifyArgs,
		async (imageBase64: string) => {
			const settings = getSettings();
			if (!settings.llmEnabled) return null;

			let ocrText: string | null = null;
			try {
				ocrText = (await recognizeTextFromWebpBase64(imageBase64)).text;
			} catch {
				ocrText = null;
			}

			const ctx = buildProviderContext();
			const decision = await aiRouter.classify(
				{ imageBase64, context: null, ocrText },
				ctx,
				buildProviderOrder(ctx),
			);
			return decision.ok ? decision.result : null;
		},
	);

	secureHandle(
		IpcChannels.LLM.GenerateStory,
		ipcLlmGenerateStoryArgs,
		async (events: EventSummary[], periodType: PeriodType) => {
			return generateStory(events, periodType);
		},
	);

	secureHandle(
		IpcChannels.LLM.TestConnection,
		ipcLlmTestConnectionArgs,
		async () => {
			const settings = getSettings();
			const model = settings.cloudLlmModel.trim() || undefined;
			return testConnection(model);
		},
	);

	secureHandle(IpcChannels.LLM.TestLocalConnection, ipcNoArgs, async () => {
		const settings = getSettings();
		if (!settings.localLlmEnabled) {
			return { success: false, error: "Local LLM is disabled" };
		}
		const baseUrl = settings.localLlmBaseUrl.trim();
		const model = settings.localLlmModel.trim();
		if (!baseUrl || !model) {
			return {
				success: false,
				error: "Local base URL or model not configured",
			};
		}
		return testLocalOpenAiConnection({ baseUrl, model });
	});
}
