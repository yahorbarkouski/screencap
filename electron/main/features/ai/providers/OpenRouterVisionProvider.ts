import { classifyScreenshot } from "../../llm/ClassificationService";
import type { ClassificationProvider, ProviderAvailability } from "../types";

export const openRouterVisionProvider: ClassificationProvider = {
	id: "cloud.openrouter.vision",

	async isAvailable(ctx): Promise<ProviderAvailability> {
		if (ctx.mode === "off")
			return { available: false, reason: "AI is disabled" };
		if (ctx.mode === "local")
			return { available: false, reason: "Cloud providers disabled" };
		if (!ctx.allowVisionUploads)
			return { available: false, reason: "Vision uploads disabled" };
		if (!ctx.apiKey)
			return { available: false, reason: "No API key configured" };
		return { available: true, reason: null };
	},

	async classify(input, ctx) {
		if (ctx.mode === "off" || ctx.mode === "local") return null;
		if (!ctx.allowVisionUploads) return null;
		if (!input.imageBase64) return null;
		return classifyScreenshot(input.imageBase64, input.context, ctx.cloudModel);
	},
};
