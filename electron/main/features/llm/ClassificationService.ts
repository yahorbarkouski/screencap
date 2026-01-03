import { isSelfApp } from "../../../shared/appIdentity";
import type { ClassificationResult } from "../../../shared/types";
import { getMemories } from "../../infra/db/repositories/MemoryRepository";
import { createLogger } from "../../infra/log";
import { callOpenRouter } from "./OpenRouterClient";
import {
	type AddictionOption,
	buildAddictionOptions,
	buildSystemPromptStage1,
	buildSystemPromptStage2,
	type ScreenContext,
} from "./prompts";
import {
	type ClassificationStage1,
	ClassificationStage1Schema,
	type ClassificationStage2,
	ClassificationStage2Schema,
} from "./schemas";

const logger = createLogger({ scope: "ClassificationService" });

function resolveOption(
	options: AddictionOption[],
	id: string | null,
): AddictionOption | null {
	if (!id) return null;
	return options.find((o) => o.id === id) ?? null;
}

function normalizeProjectProgress(
	project: string | null,
	progress: ClassificationStage1["project_progress"],
): ClassificationStage1["project_progress"] {
	if (!project || !progress.shown) {
		return { shown: false, confidence: 0 };
	}

	return { shown: true, confidence: progress.confidence };
}

function normalizeStage2Decision(
	candidates: AddictionOption[],
	stage2: ClassificationStage2,
): {
	confirmed: AddictionOption | null;
	candidate: {
		option: AddictionOption;
		confidence: number;
		prompt: string | null;
	} | null;
	evidence: string[];
} {
	const option = resolveOption(candidates, stage2.addiction_id);
	if (!option)
		return { confirmed: null, candidate: null, evidence: stage2.evidence };

	if (stage2.decision === "confirmed" && stage2.confidence >= 0.75) {
		return { confirmed: option, candidate: null, evidence: stage2.evidence };
	}

	if (stage2.decision === "candidate") {
		return {
			confirmed: null,
			candidate: {
				option,
				confidence: stage2.confidence,
				prompt: stage2.manual_prompt ?? null,
			},
			evidence: stage2.evidence,
		};
	}

	return { confirmed: null, candidate: null, evidence: stage2.evidence };
}

function shouldDisableAddictionTracking(
	context: ScreenContext | null,
): boolean {
	if (!context) return false;
	return isSelfApp({
		bundleId: context.appBundleId,
		name: context.appName,
		windowTitle: context.windowTitle,
	});
}

export async function classifyScreenshot(
	imageBase64: string,
	context: ScreenContext | null = null,
	model?: string | null,
): Promise<ClassificationResult | null> {
	logger.debug("Starting classification...", { hasContext: !!context });

	const memories = getMemories();
	const addictions = buildAddictionOptions(memories);
	const isMetaAddictionScreen = shouldDisableAddictionTracking(context);

	const stage1 = await callOpenRouter<ClassificationStage1>(
		[
			{
				role: "system",
				content: buildSystemPromptStage1(memories, addictions, context),
			},
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: `data:image/webp;base64,${imageBase64}` },
					},
					{ type: "text", text: "Classify this screenshot." },
				],
			},
		],
		ClassificationStage1Schema,
		{ model: model?.trim() || undefined },
	);

	const projectProgress = normalizeProjectProgress(
		stage1.project,
		stage1.project_progress,
	);

	let trackedAddiction: { detected: boolean; name: string | null } = {
		detected: false,
		name: null,
	};
	let addictionCandidate: {
		name: string;
		confidence: number;
		prompt: string | null;
	} | null = null;

	const trackingEnabled =
		addictions.length > 0 &&
		stage1.addiction_triage.tracking_enabled &&
		!isMetaAddictionScreen;
	const candidates = trackingEnabled
		? stage1.addiction_triage.candidates
				.filter((c) => addictions.some((a) => a.id === c.addiction_id))
				.sort((a, b) => b.likelihood - a.likelihood)
				.slice(0, 5)
				.map((c) => addictions.find((a) => a.id === c.addiction_id))
				.filter((a): a is AddictionOption => !!a)
		: [];

	if (trackingEnabled && candidates.length > 0) {
		const stage2 = await callOpenRouter<ClassificationStage2>(
			[
				{
					role: "system",
					content: buildSystemPromptStage2(candidates, context),
				},
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: `data:image/webp;base64,${imageBase64}` },
						},
						{
							type: "text",
							text: JSON.stringify(
								{
									candidates: candidates.map((c) => ({
										id: c.id,
										definition: c.definition,
									})),
									triage: stage1.addiction_triage,
								},
								null,
								2,
							),
						},
					],
				},
			],
			ClassificationStage2Schema,
			{ model: model?.trim() || undefined },
		);

		const resolved = normalizeStage2Decision(candidates, stage2);
		if (resolved.confirmed) {
			trackedAddiction = { detected: true, name: resolved.confirmed.name };
			addictionCandidate = null;
		} else if (resolved.candidate) {
			trackedAddiction = { detected: false, name: null };
			addictionCandidate = {
				name: resolved.candidate.option.name,
				confidence: resolved.candidate.confidence,
				prompt: resolved.candidate.prompt,
			};
		}
	}

	const result: ClassificationResult = {
		category: stage1.category,
		subcategories: stage1.subcategories,
		project: stage1.project,
		project_progress: projectProgress,
		tags: stage1.tags,
		confidence: stage1.confidence,
		caption: stage1.caption,
		tracked_addiction: trackedAddiction,
		addiction_candidate: trackedAddiction.detected
			? null
			: (addictionCandidate?.name ?? null),
		addiction_confidence: trackedAddiction.detected
			? null
			: (addictionCandidate?.confidence ?? null),
		addiction_prompt: trackedAddiction.detected
			? null
			: (addictionCandidate?.prompt ?? null),
	};

	logger.debug("Classification complete", { category: result.category });
	return result;
}
