import type { ClassificationResult } from "../../../shared/types";
import type { ScreenContext } from "../llm/prompts";

export type AiMode = "off" | "local" | "hybrid" | "cloud";

export type ClassificationProviderContext = {
	mode: AiMode;
	apiKey: string | null;
	allowVisionUploads: boolean;
	cloudModel: string | null;
	localBaseUrl: string | null;
	localModel: string | null;
};

export type ClassificationInput = {
	imageBase64: string | null;
	context: ScreenContext | null;
	ocrText: string | null;
};

export type ProviderAvailability = {
	available: boolean;
	reason: string | null;
};

export type ProviderAttempt = {
	providerId: string;
	available: boolean;
	latencyMs: number;
	error: string | null;
};

export type ClassificationDecision =
	| {
			ok: true;
			providerId: string;
			result: ClassificationResult;
			attempts: ProviderAttempt[];
	  }
	| {
			ok: false;
			providerId: null;
			result: null;
			attempts: ProviderAttempt[];
	  };

export interface ClassificationProvider {
	id: string;
	isAvailable: (
		ctx: ClassificationProviderContext,
	) => Promise<ProviderAvailability>;
	classify: (
		input: ClassificationInput,
		ctx: ClassificationProviderContext,
	) => Promise<ClassificationResult | null>;
}
