import { powerMonitor, screen } from "electron";
import { SELF_APP_BUNDLE_ID } from "../../../shared/appIdentity";
import type {
	CaptureIntent,
	CaptureTriggerResult,
} from "../../../shared/types";
import { updateEvent } from "../../infra/db/repositories/EventRepository";
import { createLogger } from "../../infra/log";
import { getCaptureInterval, getSettings } from "../../infra/settings";
import {
	broadcastEventUpdated,
	broadcastPermissionRequired,
} from "../../infra/windows";
import {
	discardActivityWindow,
	finalizeActivityWindow,
	getLastKnownCandidate,
	startActivityWindowTracking,
	stopActivityWindowTracking,
	type WindowedCaptureResult,
} from "../activityWindow";
import { evaluateAutomationPolicy } from "../automationRules";
import { captureAllDisplays } from "../capture";
import { collectActivityContext } from "../context";
import { processCaptureGroup } from "../events";
import { checkScreenCapturePermission } from "../permissions";

const logger = createLogger({ scope: "Scheduler" });

type SchedulerState = "stopped" | "running" | "paused";
type ManualCaptureOptions = {
	primaryDisplayId?: string;
	intent?: CaptureIntent;
};

const DEFAULT_INTERVAL_MINUTES = 5;
const IDLE_SKIP_SECONDS = 5 * 60;

let state: SchedulerState = "stopped";
let captureInterval: NodeJS.Timeout | null = null;
let currentIntervalMinutes = DEFAULT_INTERVAL_MINUTES;
let captureLock: Promise<void> | null = null;

type CapturedWindow = Extract<WindowedCaptureResult, { kind: "capture" }>;

function getIntervalMs(): number {
	return currentIntervalMinutes * 60 * 1000;
}

async function processCapturedWindow(
	windowed: CapturedWindow,
): Promise<CaptureTriggerResult> {
	const intervalMs = getIntervalMs();
	const primaryDisplayId =
		windowed.primaryDisplayId ?? String(screen.getPrimaryDisplay().id);

	const result = await processCaptureGroup({
		captures: windowed.captures,
		intervalMs,
		primaryDisplayId,
		context: windowed.context,
	});

	if (!result.merged && result.eventId) {
		updateEvent(result.eventId, {
			timestamp: windowed.windowStart,
			endTimestamp: windowed.windowEnd,
		});
		broadcastEventUpdated(result.eventId);
	}

	return result;
}

async function runWindowedCaptureCycle(): Promise<CaptureTriggerResult> {
	if (captureLock) {
		logger.debug("Capture already in progress, skipping");
		return { merged: false, eventId: null };
	}

	let releaseLock!: () => void;
	captureLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});

	try {
		const hasPermission = checkScreenCapturePermission();
		const idleTime = powerMonitor.getSystemIdleTime();
		const windowEnd = Date.now();

		logger.info("Scheduled capture starting", {
			hasPermission,
			idleTimeSeconds: idleTime,
		});

		if (!hasPermission) {
			logger.warn("No screen capture permission");
			broadcastPermissionRequired();
			await discardActivityWindow(windowEnd);
			return { merged: false, eventId: null };
		}

		if (idleTime > IDLE_SKIP_SECONDS) {
			const idleStartAt = windowEnd - idleTime * 1000;
			logger.info(`System idle for ${idleTime}s, finalizing before idle`, {
				idleStartAt,
			});

			const windowed = await finalizeActivityWindow(idleStartAt);
			await discardActivityWindow(windowEnd);
			if (windowed.kind !== "capture") {
				logger.info("Scheduled capture skipped (idle)", {
					reason: windowed.reason,
				});
				return { merged: false, eventId: null };
			}
			return await processCapturedWindow(windowed);
		}

		const windowed = await finalizeActivityWindow(windowEnd);
		if (windowed.kind !== "capture") {
			logger.info("Scheduled capture skipped", { reason: windowed.reason });
			return { merged: false, eventId: null };
		}
		logger.info("Scheduled capture completed", {
			captures: windowed.captures.length,
		});
		return await processCapturedWindow(windowed);
	} finally {
		releaseLock();
		captureLock = null;
	}
}

async function runCaptureCycle(
	reason: "scheduled" | "manual",
	options?: ManualCaptureOptions,
): Promise<CaptureTriggerResult> {
	if (captureLock) {
		if (reason === "scheduled") {
			logger.debug("Capture already in progress, skipping");
			return { merged: false, eventId: null };
		}
		logger.debug("Capture already in progress, waiting");
		await captureLock;
	}

	let releaseLock!: () => void;
	captureLock = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});

	try {
		const hasPermission = checkScreenCapturePermission();
		const idleTime = powerMonitor.getSystemIdleTime();

		logger.debug(`Capture cycle (${reason})`, {
			hasPermission,
			idleTimeSeconds: idleTime,
		});

		if (!hasPermission) {
			logger.warn("No screen capture permission");
			broadcastPermissionRequired();
			return { merged: false, eventId: null };
		}

		if (reason === "scheduled" && idleTime > IDLE_SKIP_SECONDS) {
			logger.debug(`System idle for ${idleTime}s, skipping scheduled capture`);
			return { merged: false, eventId: null };
		}

		const context =
			reason === "manual"
				? getLastKnownCandidate()?.context ?? null
				: await collectActivityContext();

		const isSelfCapture = context?.app.bundleId === SELF_APP_BUNDLE_ID;
		if (reason === "scheduled" && isSelfCapture) {
			logger.debug("Active app is Screencap, skipping capture");
			return { merged: false, eventId: null };
		}

		if (reason === "scheduled" && context) {
			const settings = getSettings();

			const policy = evaluateAutomationPolicy(
				{
					appBundleId: context.app.bundleId,
					urlHost: context.url?.host ?? null,
				},
				settings.automationRules,
			);

			if (policy.capture === "skip") {
				logger.debug("Automation rule says skip capture", {
					bundleId: context.app.bundleId,
					urlHost: context.url?.host ?? null,
				});
				return { merged: false, eventId: null };
			}
		}

		const primaryDisplayId =
			options?.primaryDisplayId ??
			context?.window.displayId ??
			String(screen.getPrimaryDisplay().id);

		const captures = await captureAllDisplays({
			highResDisplayId: primaryDisplayId,
		});
		logger.info(`Captured ${captures.length} displays`);

		const intervalMs = getIntervalMs();

		if (captures.length === 0) {
			logger.warn("No displays captured, skipping event creation");
			return { merged: false, eventId: null };
		}

		const isProjectProgressIntent =
			reason === "manual" && options?.intent === "project_progress";
		const deferLlmQueue = isProjectProgressIntent;

		const result = await processCaptureGroup({
			captures,
			intervalMs,
			primaryDisplayId,
			context,
			enqueueToLlmQueue: !deferLlmQueue,
			allowMerge: !isProjectProgressIntent,
		});

		if (
			reason === "manual" &&
			options?.intent === "project_progress" &&
			result.eventId
		) {
			updateEvent(result.eventId, {
				projectProgress: 1,
				projectProgressEvidence: "manual",
			});
			broadcastEventUpdated(result.eventId);
		}

		logger.info(`Capture cycle (${reason}) completed successfully`);
		return result;
	} catch (error) {
		logger.error(`Capture cycle (${reason}) failed:`, error);
		throw error;
	} finally {
		releaseLock();
		captureLock = null;
	}
}

async function tick(): Promise<void> {
	if (state !== "running") {
		logger.debug(`Scheduler is ${state}, skipping tick`);
		return;
	}

	logger.info("Scheduler tick");
	await runWindowedCaptureCycle();
}

export function startScheduler(intervalMinutes?: number): void {
	if (intervalMinutes) {
		currentIntervalMinutes = intervalMinutes;
	} else {
		currentIntervalMinutes = getCaptureInterval() || DEFAULT_INTERVAL_MINUTES;
	}

	if (captureInterval) {
		clearInterval(captureInterval);
	}

	stopActivityWindowTracking();
	startActivityWindowTracking();

	state = "running";
	const intervalMs = getIntervalMs();

	logger.info("Starting scheduler", {
		intervalMs,
		minutes: currentIntervalMinutes,
		idleSkipSeconds: IDLE_SKIP_SECONDS,
	});

	captureInterval = setInterval(() => {
		tick();
	}, intervalMs);
}

export function stopScheduler(): void {
	if (captureInterval) {
		clearInterval(captureInterval);
		captureInterval = null;
	}
	stopActivityWindowTracking();
	state = "stopped";
	logger.info("Scheduler stopped");
}

export function pauseScheduler(): void {
	state = "paused";
	stopActivityWindowTracking();
	logger.info("Scheduler paused");
}

export function resumeScheduler(): void {
	if (captureInterval) {
		state = "running";
		startActivityWindowTracking();
		logger.info("Scheduler resumed");
	} else {
		startScheduler();
	}
}

export function isSchedulerRunning(): boolean {
	return state === "running";
}

export function isSchedulerPaused(): boolean {
	return state === "paused";
}

export function getSchedulerState(): SchedulerState {
	return state;
}

export async function triggerManualCapture(): Promise<void> {
	logger.info("Manual capture triggered");
	await runCaptureCycle("manual");
}

export async function triggerManualCaptureWithPrimaryDisplay(
	options?: ManualCaptureOptions,
): Promise<CaptureTriggerResult> {
	logger.info("Manual capture triggered", {
		primaryDisplayId: options?.primaryDisplayId ?? null,
		intent: options?.intent ?? "default",
	});
	return await runCaptureCycle("manual", options);
}

export function setSchedulerInterval(minutes: number): void {
	logger.info(`Changing interval to ${minutes} minutes`);
	stopScheduler();
	startScheduler(minutes);
}
