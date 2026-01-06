import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { CaptureResult, Event } from "../../../shared/types";
import {
	getLatestEventByDisplayId,
	insertEvent,
	updateEvent,
} from "../../infra/db/repositories/EventRepository";
import { insertEventScreenshots } from "../../infra/db/repositories/EventScreenshotRepository";
import { addToQueue } from "../../infra/db/repositories/QueueRepository";
import { createLogger } from "../../infra/log";
import { getSettings } from "../../infra/settings";
import {
	broadcastEventCreated,
	broadcastEventUpdated,
} from "../../infra/windows";
import { ensureAppIcon } from "../appIcons/AppIconService";
import type { PolicyResult } from "../automationRules";
import { evaluateAutomationPolicy } from "../automationRules";
import {
	computeFingerprint,
	isSimilarFingerprint,
} from "../capture/FingerprintService";
import type { ActivityContext } from "../context";
import { ensureFavicon } from "../favicons/FaviconService";

const logger = createLogger({ scope: "EventService" });

export interface ProcessCaptureOptions {
	capture: CaptureResult;
	intervalMs: number;
	imageBuffer: Buffer | null;
	context: ActivityContext | null;
}

function contextKeysMatch(
	lastKey: string | null | undefined,
	currentKey: string | null,
): boolean {
	if (!lastKey && !currentKey) return true;
	if (!lastKey || !currentKey) return false;
	return lastKey === currentKey;
}

function highResPathFromLowResPath(
	path: string | null | undefined,
): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

async function safeUnlink(path: string | null | undefined): Promise<void> {
	if (!path) return;
	try {
		await unlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.warn("Failed to delete capture file", { path });
		}
	}
}

async function safeUnlinkWithHighRes(
	originalPath: string | null | undefined,
): Promise<void> {
	const highResPath = highResPathFromLowResPath(originalPath);
	await Promise.all([safeUnlink(originalPath), safeUnlink(highResPath)]);
}

function buildFallbackCaption(context: ActivityContext | null): string {
	if (!context) return "Screenshot captured";
	const parts: string[] = [];
	if (context.content?.title) {
		parts.push(context.content.title);
	} else if (context.window.title) {
		parts.push(context.window.title);
	}
	if (context.app.name && !parts.some((p) => p.includes(context.app.name))) {
		parts.push(`in ${context.app.name}`);
	}
	return parts.length > 0 ? parts.join(" ") : "Screenshot captured";
}

function applyPolicyOverrides(
	eventId: string,
	policy: PolicyResult,
	context: ActivityContext | null,
): void {
	const updates: Partial<Event> = {
		status: "completed",
		caption: buildFallbackCaption(context),
	};

	if (policy.overrides.category) {
		updates.category = policy.overrides.category;
	}
	if (policy.overrides.tags) {
		updates.tags = JSON.stringify(policy.overrides.tags);
	}

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

	updateEvent(eventId, updates);
}

export async function processCaptureResult(
	options: ProcessCaptureOptions,
): Promise<{ merged: boolean; eventId: string }> {
	const { capture, intervalMs, context } = options;
	const maxMergeGapMs = intervalMs * 2 + 30_000;

	const last = getLatestEventByDisplayId(capture.displayId);
	const lastEnd = last ? (last.endTimestamp ?? last.timestamp) : null;

	const currentContextKey = context?.key ?? null;

	if (
		last &&
		lastEnd !== null &&
		capture.timestamp - lastEnd <= maxMergeGapMs
	) {
		const contextMatch = contextKeysMatch(last.contextKey, currentContextKey);

		if (!contextMatch) {
			logger.debug("Context key changed, creating new event", {
				lastKey: last.contextKey,
				currentKey: currentContextKey,
			});
		} else {
			let stableHash = last.stableHash;
			let detailHash = last.detailHash;

			if (
				(!stableHash || !detailHash) &&
				last.originalPath &&
				existsSync(last.originalPath)
			) {
				const previousBuffer = readFileSync(last.originalPath);
				const fp = await computeFingerprint(previousBuffer);
				stableHash = fp.stableHash;
				detailHash = fp.detailHash;
				updateEvent(last.id, {
					stableHash,
					detailHash,
					endTimestamp: lastEnd,
					mergedCount: last.mergedCount ?? 1,
				});
			}

			const cmp = isSimilarFingerprint(
				{ stableHash: stableHash ?? null, detailHash: detailHash ?? null },
				{ stableHash: capture.stableHash, detailHash: capture.detailHash },
			);

			if (cmp.isSimilar) {
				updateEvent(last.id, {
					endTimestamp: capture.timestamp,
					mergedCount: (last.mergedCount ?? 1) + 1,
				});

				void Promise.all([
					safeUnlink(capture.thumbnailPath),
					safeUnlinkWithHighRes(capture.originalPath),
				]);

				logger.debug("Merged capture with existing event", {
					eventId: last.id,
				});
				broadcastEventUpdated(last.id);
				return { merged: true, eventId: last.id };
			}
		}
	}

	logger.debug("Creating new event", {
		id: capture.id,
		contextKey: currentContextKey,
	});

	insertEvent({
		id: capture.id,
		timestamp: capture.timestamp,
		endTimestamp: capture.timestamp,
		displayId: capture.displayId,
		thumbnailPath: capture.thumbnailPath,
		originalPath: capture.originalPath,
		stableHash: capture.stableHash,
		detailHash: capture.detailHash,
		mergedCount: 1,
		status: "pending",
		appBundleId: context?.app.bundleId ?? null,
		appName: context?.app.name ?? null,
		windowTitle: context?.window.title ?? null,
		urlHost: context?.url?.host ?? null,
		urlCanonical: context?.url?.urlCanonical ?? null,
		contentKind: context?.content?.kind ?? null,
		contentId: context?.content?.id ?? null,
		contentTitle: context?.content?.title ?? null,
		isFullscreen: context?.window.isFullscreen ? 1 : 0,
		contextProvider: context?.provider ?? null,
		contextConfidence: context?.confidence ?? null,
		contextKey: currentContextKey,
		contextJson: context ? JSON.stringify(context) : null,
	});

	if (context?.app.bundleId) {
		void ensureAppIcon(context.app.bundleId);
	}

	if (context?.url?.host) {
		void ensureFavicon(context.url.host, context.url.urlCanonical ?? null);
	}

	const settings = getSettings();
	const policy = evaluateAutomationPolicy(
		{
			appBundleId: context?.app.bundleId ?? null,
			urlHost: context?.url?.host ?? null,
		},
		settings.automationRules,
	);

	if (policy.llm === "skip" || !settings.llmEnabled) {
		logger.debug(
			"LLM skipped (policy or globally disabled), finalizing locally",
			{
				eventId: capture.id,
				llmEnabled: settings.llmEnabled,
			},
		);
		applyPolicyOverrides(capture.id, policy, context);
		broadcastEventCreated(capture.id);
		return { merged: false, eventId: capture.id };
	}

	if (capture.originalPath && existsSync(capture.originalPath)) {
		addToQueue(capture.id);
		logger.debug("Added to LLM queue", { eventId: capture.id });
	} else {
		updateEvent(capture.id, { status: "failed" });
		broadcastEventUpdated(capture.id);
	}

	broadcastEventCreated(capture.id);
	return { merged: false, eventId: capture.id };
}

export interface ProcessCaptureGroupOptions {
	captures: CaptureResult[];
	intervalMs: number;
	primaryDisplayId: string | null;
	context: ActivityContext | null;
	enqueueToLlmQueue?: boolean;
	allowMerge?: boolean;
}

function pickPrimaryCapture(
	captures: CaptureResult[],
	primaryDisplayId: string | null,
): CaptureResult {
	if (primaryDisplayId) {
		const found = captures.find((c) => c.displayId === primaryDisplayId);
		if (found) return found;
	}
	return captures[0];
}

export async function processCaptureGroup(
	options: ProcessCaptureGroupOptions,
): Promise<{ merged: boolean; eventId: string | null }> {
	const { captures, intervalMs, primaryDisplayId, context } = options;
	if (captures.length === 0) return { merged: false, eventId: null };

	const primaryCapture = pickPrimaryCapture(captures, primaryDisplayId);
	const effectiveContext =
		context && context.window.displayId === primaryCapture.displayId
			? context
			: null;
	const currentContextKey = effectiveContext?.key ?? null;

	const maxMergeGapMs = intervalMs * 2 + 30_000;
	const last = getLatestEventByDisplayId(primaryCapture.displayId);
	const lastEnd = last ? (last.endTimestamp ?? last.timestamp) : null;

	if (options.allowMerge !== false) {
		if (
			last &&
			lastEnd !== null &&
			primaryCapture.timestamp - lastEnd <= maxMergeGapMs
		) {
			const contextMatch = contextKeysMatch(last.contextKey, currentContextKey);

			if (!contextMatch) {
				logger.debug("Context key changed, creating new event", {
					lastKey: last.contextKey,
					currentKey: currentContextKey,
				});
			} else {
				let stableHash = last.stableHash;
				let detailHash = last.detailHash;

				if (
					(!stableHash || !detailHash) &&
					last.originalPath &&
					existsSync(last.originalPath)
				) {
					const previousBuffer = readFileSync(last.originalPath);
					const fp = await computeFingerprint(previousBuffer);
					stableHash = fp.stableHash;
					detailHash = fp.detailHash;
					updateEvent(last.id, {
						stableHash,
						detailHash,
						endTimestamp: lastEnd,
						mergedCount: last.mergedCount ?? 1,
					});
				}

				const cmp = isSimilarFingerprint(
					{ stableHash: stableHash ?? null, detailHash: detailHash ?? null },
					{
						stableHash: primaryCapture.stableHash,
						detailHash: primaryCapture.detailHash,
					},
				);

				if (cmp.isSimilar) {
					updateEvent(last.id, {
						endTimestamp: primaryCapture.timestamp,
						mergedCount: (last.mergedCount ?? 1) + 1,
					});

					void Promise.all(
						captures.flatMap((capture) => [
							safeUnlink(capture.thumbnailPath),
							safeUnlinkWithHighRes(capture.originalPath),
						]),
					);

					logger.debug("Merged capture group with existing event", {
						eventId: last.id,
					});
					broadcastEventUpdated(last.id);
					return { merged: true, eventId: last.id };
				}
			}
		}
	}

	const eventId = primaryCapture.id;
	const isManualProjectProgress =
		options.enqueueToLlmQueue === false && options.allowMerge === false;

	logger.debug("Creating new event from capture group", {
		id: eventId,
		primaryDisplayId: primaryCapture.displayId,
		contextKey: currentContextKey,
		captures: captures.length,
	});

	insertEvent({
		id: eventId,
		timestamp: primaryCapture.timestamp,
		endTimestamp: primaryCapture.timestamp,
		displayId: primaryCapture.displayId,
		thumbnailPath: primaryCapture.thumbnailPath,
		originalPath: primaryCapture.originalPath,
		stableHash: primaryCapture.stableHash,
		detailHash: primaryCapture.detailHash,
		mergedCount: 1,
		status: "pending",
		projectProgress: isManualProjectProgress ? 1 : 0,
		projectProgressEvidence: isManualProjectProgress ? "manual" : null,
		appBundleId: effectiveContext?.app.bundleId ?? null,
		appName: effectiveContext?.app.name ?? null,
		windowTitle: effectiveContext?.window.title ?? null,
		urlHost: effectiveContext?.url?.host ?? null,
		urlCanonical: effectiveContext?.url?.urlCanonical ?? null,
		contentKind: effectiveContext?.content?.kind ?? null,
		contentId: effectiveContext?.content?.id ?? null,
		contentTitle: effectiveContext?.content?.title ?? null,
		isFullscreen: effectiveContext?.window.isFullscreen ? 1 : 0,
		contextProvider: effectiveContext?.provider ?? null,
		contextConfidence: effectiveContext?.confidence ?? null,
		contextKey: currentContextKey,
		contextJson: effectiveContext ? JSON.stringify(effectiveContext) : null,
	});

	if (effectiveContext?.app.bundleId) {
		void ensureAppIcon(effectiveContext.app.bundleId);
	}

	if (effectiveContext?.url?.host) {
		void ensureFavicon(
			effectiveContext.url.host,
			effectiveContext.url.urlCanonical ?? null,
		);
	}

	insertEventScreenshots(
		captures.map((c) => ({
			id: c.id,
			eventId,
			displayId: c.displayId,
			isPrimary: c.id === primaryCapture.id,
			thumbnailPath: c.thumbnailPath,
			originalPath: c.originalPath,
			stableHash: c.stableHash,
			detailHash: c.detailHash,
			width: c.width,
			height: c.height,
			timestamp: c.timestamp,
		})),
	);

	const settings = getSettings();
	const policy = evaluateAutomationPolicy(
		{
			appBundleId: effectiveContext?.app.bundleId ?? null,
			urlHost: effectiveContext?.url?.host ?? null,
		},
		settings.automationRules,
	);

	if (policy.llm === "skip") {
		logger.debug("Automation rule says skip LLM, finalizing locally", {
			eventId,
		});
		applyPolicyOverrides(eventId, policy, effectiveContext);
		broadcastEventCreated(eventId);
		return { merged: false, eventId };
	}

	if (primaryCapture.originalPath && existsSync(primaryCapture.originalPath)) {
		if (options.enqueueToLlmQueue !== false) {
			addToQueue(eventId);
			logger.debug("Added to LLM queue", { eventId });
		}
	} else {
		updateEvent(eventId, { status: "failed" });
		broadcastEventUpdated(eventId);
	}

	broadcastEventCreated(eventId);
	return { merged: false, eventId };
}
