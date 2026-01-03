import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isSelfApp } from "../../../shared/appIdentity";
import type { Event } from "../../../shared/types";
import {
	cleanupQueueForCompletedEvents,
	getEventById,
	getLatestCompletedEventByFingerprint,
	listPendingEventIdsMissingQueue,
	recoverInterruptedEventProcessing,
	updateEvent,
} from "../../infra/db/repositories/EventRepository";
import {
	addToQueue,
	getDueQueueItems,
	getQueueItems,
	incrementAttempts,
	isEventQueued,
	MAX_ATTEMPTS,
	removeFromQueue,
} from "../../infra/db/repositories/QueueRepository";
import { createLogger } from "../../infra/log";
import { getOriginalsDir } from "../../infra/paths";
import { getSettings } from "../../infra/settings";
import { broadcastEventUpdated } from "../../infra/windows";
import {
	type ClassificationProviderContext,
	createAiRouter,
	localOpenAiProvider,
	openRouterTextProvider,
	openRouterVisionProvider,
} from "../ai";
import {
	evaluateAutomationPolicy,
	type PolicyResult,
} from "../automationRules";
import type { ScreenContext } from "../llm";
import {
	recognizeTextFromImagePath,
	recognizeTextFromWebpBase64,
} from "../ocr";
import { canonicalizeProject } from "../projects";

const logger = createLogger({ scope: "QueueService" });

const PROCESS_INTERVAL_MS = 10_000;
const ITEM_DELAY_MS = 1000;

let processingInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

const aiRouter = createAiRouter([
	localOpenAiProvider,
	openRouterTextProvider,
	openRouterVisionProvider,
]);

function includesPornTag(tags: string[]): boolean {
	return tags.some((tag) => {
		const t = tag.trim().toLowerCase();
		return t === "porn" || t === "nsfw";
	});
}

function parseStringArrayJson(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

function buildProviderContext(
	settings: ReturnType<typeof getSettings>,
): ClassificationProviderContext {
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

function extractScreenContext(event: {
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	contentKind: string | null;
	contentTitle: string | null;
	userCaption: string | null;
	selectedProject: string | null;
}): ScreenContext | null {
	if (
		!event.appBundleId &&
		!event.appName &&
		!event.windowTitle &&
		!event.urlHost &&
		!event.contentKind &&
		!event.contentTitle &&
		!event.userCaption &&
		!event.selectedProject
	) {
		return null;
	}
	return {
		appBundleId: event.appBundleId,
		appName: event.appName,
		windowTitle: event.windowTitle,
		urlHost: event.urlHost,
		contentKind: event.contentKind,
		contentTitle: event.contentTitle,
		userCaption: event.userCaption,
		selectedProject: event.selectedProject,
	};
}

function highResPathForEventId(eventId: string): string {
	return join(getOriginalsDir(), `${eventId}.hq.png`);
}

function deleteHighResIfExists(eventId: string): void {
	const path = highResPathForEventId(eventId);
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		logger.warn("Failed to delete high-res capture", { eventId, path });
	}
}

function buildFallbackCaption(event: Event): string {
	const parts: string[] = [];
	if (event.contentTitle) {
		parts.push(event.contentTitle);
	} else if (event.windowTitle) {
		parts.push(event.windowTitle);
	}
	const appName = event.appName;
	if (appName && !parts.some((p) => p.includes(appName))) {
		parts.push(`in ${appName}`);
	}
	return parts.length > 0 ? parts.join(" ") : "Screenshot captured";
}

function finalizeEventLocally(event: Event, policy: PolicyResult): void {
	const hasManualCaption = (event.caption ?? "").trim().length > 0;
	const forcedProject = canonicalizeProject(event.project);
	const updates: Partial<Event> = {
		status: "completed",
		caption: hasManualCaption ? event.caption : buildFallbackCaption(event),
	};

	if (policy.overrides.category) {
		updates.category = policy.overrides.category;
	}
	if (policy.overrides.tags) {
		updates.tags = JSON.stringify(policy.overrides.tags);
	}

	if (!forcedProject) {
		switch (policy.overrides.projectMode) {
			case "skip":
				updates.project = null;
				updates.projectProgress = 0;
				updates.projectProgressConfidence = null;
				updates.projectProgressEvidence = null;
				break;
			case "force":
				if (policy.overrides.project) {
					updates.project = policy.overrides.project;
				}
				break;
		}
	}

	updateEvent(event.id, updates);
}

function repairPendingEventsMissingQueue(): void {
	const ids = listPendingEventIdsMissingQueue(100);
	if (ids.length === 0) return;

	for (const id of ids) {
		const event = getEventById(id);
		if (!event) continue;

		const hasFile =
			!!event.originalPath &&
			event.originalPath.trim().length > 0 &&
			existsSync(event.originalPath);
		if (!hasFile) {
			updateEvent(id, { status: "failed" });
			broadcastEventUpdated(id);
			continue;
		}

		if (event.projectProgressEvidence === "manual") {
			continue;
		}

		if (!isEventQueued(id)) {
			addToQueue(id);
		}
	}
}

async function processQueueItem(item: {
	id: string;
	eventId: string;
}): Promise<void> {
	try {
		const event = getEventById(item.eventId);
		if (!event) {
			removeFromQueue(item.id);
			logger.warn("Event not found for queue item, removing", {
				eventId: item.eventId,
			});
			return;
		}
		if (event.status === "completed") {
			removeFromQueue(item.id);
			return;
		}

		if (event.status !== "processing") {
			updateEvent(item.eventId, { status: "processing" });
			broadcastEventUpdated(item.eventId);
		}

		const settings = getSettings();
		const policy = evaluateAutomationPolicy(
			{ appBundleId: event.appBundleId, urlHost: event.urlHost },
			settings.automationRules,
		);

		if (policy.llm === "skip") {
			logger.debug(
				"Automation rule says skip LLM (post-enqueue), finalizing locally",
				{
					eventId: item.eventId,
				},
			);
			finalizeEventLocally(event, policy);
			deleteHighResIfExists(item.eventId);
			removeFromQueue(item.id);
			broadcastEventUpdated(item.eventId);
			return;
		}

		if (event.stableHash && event.contextKey) {
			const cached = getLatestCompletedEventByFingerprint({
				stableHash: event.stableHash,
				contextKey: event.contextKey,
				excludeId: event.id,
			});

			if (cached) {
				const latest = getEventById(item.eventId);
				const hasManualCaption = (latest?.caption ?? "").trim().length > 0;
				const isManualProgress = latest?.projectProgressEvidence === "manual";
				const forcedProject = canonicalizeProject(latest?.project ?? null);

				let category = cached.category ?? "Unknown";
				let tagsJson = cached.tags ?? JSON.stringify([]);
				const subcategoriesJson = cached.subcategories ?? JSON.stringify([]);

				let project = forcedProject ?? cached.project;
				let resolvedProgress = isManualProgress
					? 1
					: cached.projectProgress === 1
						? 1
						: 0;
				let resolvedEvidence: string | null = isManualProgress
					? "manual"
					: (cached.projectProgressEvidence ?? null);

				const resolvedCaption = hasManualCaption
					? (latest?.caption ?? null)
					: (cached.caption ?? buildFallbackCaption(event));

				if (includesPornTag(parseStringArrayJson(tagsJson))) {
					category = "Leisure";
				}

				if (policy.overrides.category) {
					category = policy.overrides.category;
				}
				if (policy.overrides.tags) {
					tagsJson = JSON.stringify(policy.overrides.tags);
				}

				if (!forcedProject) {
					switch (policy.overrides.projectMode) {
						case "skip":
							project = null;
							resolvedProgress = 0;
							resolvedEvidence = null;
							break;
						case "force":
							if (policy.overrides.project) {
								project = canonicalizeProject(policy.overrides.project);
							}
							break;
					}
				}

				const shouldDisableAddictionTracking = isSelfApp({
					bundleId: latest?.appBundleId ?? event.appBundleId,
					name: latest?.appName ?? event.appName,
					windowTitle: latest?.windowTitle ?? event.windowTitle,
				});

				updateEvent(item.eventId, {
					category,
					subcategories: subcategoriesJson,
					project: canonicalizeProject(project),
					projectProgress: resolvedProgress,
					projectProgressConfidence:
						resolvedProgress === 1
							? (cached.projectProgressConfidence ?? null)
							: null,
					projectProgressEvidence: resolvedEvidence,
					tags: tagsJson,
					confidence: cached.confidence ?? null,
					caption: resolvedCaption,
					trackedAddiction: shouldDisableAddictionTracking
						? null
						: (cached.trackedAddiction ?? null),
					addictionCandidate: shouldDisableAddictionTracking
						? null
						: (cached.addictionCandidate ?? null),
					addictionConfidence: shouldDisableAddictionTracking
						? null
						: (cached.addictionConfidence ?? null),
					addictionPrompt: shouldDisableAddictionTracking
						? null
						: (cached.addictionPrompt ?? null),
					status: "completed",
				});

				if (resolvedProgress !== 1) {
					deleteHighResIfExists(item.eventId);
				}

				removeFromQueue(item.id);
				broadcastEventUpdated(item.eventId);
				logger.debug("Applied cached classification", {
					eventId: item.eventId,
					sourceEventId: cached.id,
				});
				return;
			}
		}

		const userCaption = (event.caption ?? "").trim();
		const context = extractScreenContext({
			appBundleId: event.appBundleId,
			appName: event.appName,
			windowTitle: event.windowTitle,
			urlHost: event.urlHost,
			contentKind: event.contentKind,
			contentTitle: event.contentTitle,
			userCaption: userCaption.length > 0 ? userCaption.slice(0, 500) : null,
			selectedProject: event.project,
		});
		const aiCtx = buildProviderContext(settings);
		const originalPath = event.originalPath;
		const hasOriginalFile =
			!!originalPath &&
			originalPath.trim().length > 0 &&
			existsSync(originalPath);
		let imageBase64: string | null = null;
		try {
			if (hasOriginalFile && originalPath) {
				imageBase64 = readFileSync(originalPath).toString("base64");
			}
		} catch (error) {
			logger.warn("Failed to read screenshot file for queue item", {
				eventId: item.eventId,
				error: String(error),
			});
		}
		if (!imageBase64) {
			if (hasOriginalFile) {
				throw new Error("Failed to read screenshot file");
			}
			updateEvent(item.eventId, { status: "failed" });
			deleteHighResIfExists(item.eventId);
			removeFromQueue(item.id);
			broadcastEventUpdated(item.eventId);
			logger.warn("Missing screenshot file for queue item, marking failed", {
				eventId: item.eventId,
			});
			return;
		}
		let ocrText: string | null = null;
		try {
			const highResPath = highResPathForEventId(item.eventId);
			if (existsSync(highResPath)) {
				ocrText = (await recognizeTextFromImagePath(highResPath)).text;
			} else {
				ocrText = (await recognizeTextFromWebpBase64(imageBase64)).text;
			}
		} catch (error) {
			logger.warn("OCR failed, continuing without OCR", {
				eventId: item.eventId,
				error: String(error),
			});
		}
		const decision = await aiRouter.classify(
			{ imageBase64, context, ocrText },
			aiCtx,
			buildProviderOrder(aiCtx),
		);

		if (decision.ok) {
			const result = decision.result;
			const latest = getEventById(item.eventId);
			const hasManualCaption = (latest?.caption ?? "").trim().length > 0;
			const isManualProgress = latest?.projectProgressEvidence === "manual";
			const forcedProject = canonicalizeProject(latest?.project ?? null);
			const shouldDisableAddictionTracking = isSelfApp({
				bundleId: latest?.appBundleId ?? event.appBundleId,
				name: latest?.appName ?? event.appName,
				windowTitle: latest?.windowTitle ?? event.windowTitle,
			});
			if (
				shouldDisableAddictionTracking &&
				(result.tracked_addiction.detected || result.addiction_candidate)
			) {
				logger.debug("Meta screen detected, clearing addiction signals", {
					eventId: item.eventId,
				});
			}

			let project = forcedProject ?? canonicalizeProject(result.project);
			let progressShown = !!project && result.project_progress.shown;
			let resolvedProgress = isManualProgress ? 1 : progressShown ? 1 : 0;
			let resolvedEvidence: string | null = isManualProgress
				? "manual"
				: progressShown
					? "llm"
					: null;
			const resolvedCaption = hasManualCaption
				? (latest?.caption ?? null)
				: result.caption;

			let category = result.category;
			let tags = result.tags;

			if (includesPornTag(tags)) {
				category = "Leisure";
			}

			if (policy.overrides.category) {
				category = policy.overrides.category;
			}
			if (policy.overrides.tags) {
				tags = policy.overrides.tags;
			}

			if (!forcedProject) {
				switch (policy.overrides.projectMode) {
					case "skip":
						project = null;
						progressShown = false;
						resolvedProgress = 0;
						resolvedEvidence = null;
						break;
					case "force":
						if (policy.overrides.project) {
							project = canonicalizeProject(policy.overrides.project);
						}
						break;
				}
			}

			updateEvent(item.eventId, {
				category,
				subcategories: JSON.stringify(result.subcategories),
				project,
				projectProgress: resolvedProgress,
				projectProgressConfidence: progressShown
					? result.project_progress.confidence
					: null,
				projectProgressEvidence: resolvedEvidence,
				tags: JSON.stringify(tags),
				confidence: result.confidence,
				caption: resolvedCaption,
				trackedAddiction: shouldDisableAddictionTracking
					? null
					: result.tracked_addiction.detected
						? result.tracked_addiction.name
						: null,
				addictionCandidate: shouldDisableAddictionTracking
					? null
					: (result.addiction_candidate ?? null),
				addictionConfidence: shouldDisableAddictionTracking
					? null
					: (result.addiction_confidence ?? null),
				addictionPrompt: shouldDisableAddictionTracking
					? null
					: (result.addiction_prompt ?? null),
				status: "completed",
			});

			if (resolvedProgress !== 1) {
				deleteHighResIfExists(item.eventId);
			}

			removeFromQueue(item.id);
			broadcastEventUpdated(item.eventId);
			logger.debug("Processed queue item", { eventId: item.eventId });
		} else {
			throw new Error(
				`All providers failed: ${decision.attempts.map((a) => `${a.providerId}:${a.error ?? "ok"}`).join(",")}`,
			);
		}
	} catch (error) {
		logger.error(`Failed to process queue item ${item.id}:`, error);

		const attempts = incrementAttempts(item.id);
		updateEvent(item.eventId, { status: "failed" });
		broadcastEventUpdated(item.eventId);

		if (attempts >= MAX_ATTEMPTS) {
			deleteHighResIfExists(item.eventId);
			removeFromQueue(item.id);
			logger.warn("Queue item exceeded max attempts", {
				id: item.id,
				eventId: item.eventId,
			});
		}
	}
}

async function processQueue(): Promise<void> {
	if (isProcessing) {
		logger.debug("Queue processing already in progress, skipping");
		return;
	}

	cleanupQueueForCompletedEvents();
	repairPendingEventsMissingQueue();

	const settings = getSettings();

	if (!settings.llmEnabled) {
		logger.debug("LLM is disabled globally, finalizing queued items locally");
		await finalizeQueueLocally();
		return;
	}

	isProcessing = true;

	try {
		const items = getDueQueueItems();

		for (const item of items) {
			await processQueueItem(item);
			await new Promise((resolve) => setTimeout(resolve, ITEM_DELAY_MS));
		}
	} finally {
		isProcessing = false;
	}
}

async function finalizeQueueLocally(): Promise<void> {
	const items = getQueueItems();
	for (const item of items) {
		const event = getEventById(item.eventId);
		if (!event) {
			removeFromQueue(item.id);
			continue;
		}
		const settings = getSettings();
		const policy = evaluateAutomationPolicy(
			{ appBundleId: event.appBundleId, urlHost: event.urlHost },
			settings.automationRules,
		);
		finalizeEventLocally(event, policy);
		removeFromQueue(item.id);
		broadcastEventUpdated(item.eventId);
	}
}

export function startQueueProcessor(): void {
	if (processingInterval) {
		clearInterval(processingInterval);
	}

	logger.info("Starting queue processor");

	const recovered = recoverInterruptedEventProcessing();
	if (recovered > 0) {
		logger.warn("Recovered interrupted processing events", { recovered });
	}

	processingInterval = setInterval(() => {
		processQueue().catch((error) => {
			logger.error("Queue processing failed", { error: String(error) });
		});
	}, PROCESS_INTERVAL_MS);

	processQueue().catch((error) => {
		logger.error("Initial queue processing failed", { error: String(error) });
	});
}

export function stopQueueProcessor(): void {
	if (processingInterval) {
		clearInterval(processingInterval);
		processingInterval = null;
		logger.info("Queue processor stopped");
	}
}

export function isQueueProcessorRunning(): boolean {
	return processingInterval !== null;
}

export function triggerQueueProcess(): void {
	processQueue().catch((error) => {
		logger.error("Triggered queue processing failed", { error: String(error) });
	});
}
