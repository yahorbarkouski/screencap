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
	logger.debug("Starting vision classification", { hasContext: !!context });

	const memories = getMemories();
	const addictions = buildAddictionOptions(memories);
	const isMetaAddictionScreen = shouldDisableAddictionTracking(context);

	logger.info("Addiction tracking setup", {
		configuredAddictions: addictions.map((a) => ({ id: a.id, name: a.name })),
		addictionsCount: addictions.length,
		isMetaScreen: isMetaAddictionScreen,
		context: context
			? {
					appName: context.appName,
					appBundleId: context.appBundleId,
					urlHost: context.urlHost,
				}
			: null,
	});

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

	logger.info("Stage1 addiction triage result", {
		trackingEnabled: stage1.addiction_triage.tracking_enabled,
		potentiallyAddictive: stage1.addiction_triage.potentially_addictive,
		rawCandidates: stage1.addiction_triage.candidates,
		candidatesCount: stage1.addiction_triage.candidates.length,
	});

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

	const rawCandidateIds = stage1.addiction_triage.candidates.map(
		(c) => c.addiction_id,
	);
	const matchedCandidateIds = stage1.addiction_triage.candidates
		.filter((c) => addictions.some((a) => a.id === c.addiction_id))
		.map((c) => c.addiction_id);

	logger.info("Candidate filtering", {
		trackingEnabled,
		rawCandidateIds,
		matchedCandidateIds,
		unmatchedIds: rawCandidateIds.filter(
			(id) => !matchedCandidateIds.includes(id),
		),
		addictionIds: addictions.map((a) => a.id),
	});

	const candidates = trackingEnabled
		? stage1.addiction_triage.candidates
				.filter((c) => addictions.some((a) => a.id === c.addiction_id))
				.sort((a, b) => b.likelihood - a.likelihood)
				.slice(0, 5)
				.map((c) => addictions.find((a) => a.id === c.addiction_id))
				.filter((a): a is AddictionOption => !!a)
		: [];

	logger.info("Final candidates for stage2", {
		candidatesCount: candidates.length,
		candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
		willRunStage2: trackingEnabled && candidates.length > 0,
	});

	if (trackingEnabled && candidates.length > 0) {
		const stage2Prompt = buildSystemPromptStage2(candidates, context);
		logger.debug("Stage2 system prompt", { prompt: stage2Prompt });

		const stage2 = await callOpenRouter<ClassificationStage2>(
			[
				{
					role: "system",
					content: stage2Prompt,
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

		logger.info("Stage2 verification result", {
			decision: stage2.decision,
			addictionId: stage2.addiction_id,
			confidence: stage2.confidence,
			evidence: stage2.evidence,
			manualPrompt: stage2.manual_prompt,
		});

		const resolved = normalizeStage2Decision(candidates, stage2);

		logger.info("Stage2 resolved decision", {
			confirmed: resolved.confirmed
				? { id: resolved.confirmed.id, name: resolved.confirmed.name }
				: null,
			candidate: resolved.candidate
				? {
						id: resolved.candidate.option.id,
						name: resolved.candidate.option.name,
						confidence: resolved.candidate.confidence,
					}
				: null,
		});

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

	const potentialProgress =
		!!stage1.project && !projectProgress.shown && stage1.potential_progress;

	const result: ClassificationResult = {
		category: stage1.category,
		subcategories: stage1.subcategories,
		project: stage1.project,
		project_progress: projectProgress,
		potential_progress: potentialProgress,
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

	logger.info("Vision classification complete", {
		category: result.category,
		trackedAddiction: result.tracked_addiction,
		addictionCandidate: result.addiction_candidate,
		addictionConfidence: result.addiction_confidence,
	});

	return result;
}
