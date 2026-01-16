import { existsSync, unlinkSync } from "node:fs";
import {
	type HqCleanupCutoffs,
	listHqCleanupCandidates,
} from "../../infra/db/repositories/EventRepository";
import { createLogger } from "../../infra/log";

const logger = createLogger({ scope: "HqRetention" });

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const REGULAR_RETENTION_HOURS = 12;
const SHARED_RETENTION_HOURS = 48;
const PROGRESS_RETENTION_HOURS = 24;
const PROGRESS_FALLBACK_DAYS = 7;
const EOD_BUFFER_HOURS = 24;

const STARTUP_DELAY_MS = 10_000;
const RUN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RUN_TIME_MS = 1_500;
const BATCH_SIZE = 100;

type HqRetentionRunReason = "startup" | "interval" | "manual";

let interval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let isRunning = false;

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function hqPathFromOriginal(originalPath: string): string | null {
	if (!originalPath.endsWith(".webp")) return null;
	return originalPath.replace(/\.webp$/, ".hq.png");
}

function safeUnlinkHq(hqPath: string): boolean {
	try {
		if (existsSync(hqPath)) {
			unlinkSync(hqPath);
			return true;
		}
	} catch {}
	return false;
}

function buildCutoffs(): HqCleanupCutoffs {
	const now = Date.now();
	return {
		regularCutoff: now - REGULAR_RETENTION_HOURS * HOUR_MS,
		sharedCutoff: now - SHARED_RETENTION_HOURS * HOUR_MS,
		progressCutoff: now - PROGRESS_RETENTION_HOURS * HOUR_MS,
		progressFallbackCutoff: now - PROGRESS_FALLBACK_DAYS * DAY_MS,
		eodBufferMs: EOD_BUFFER_HOURS * HOUR_MS,
	};
}

async function runHqCleanup(reason: HqRetentionRunReason): Promise<void> {
	if (isRunning) {
		return;
	}

	isRunning = true;

	try {
		const cutoffs = buildCutoffs();
		let deleted = 0;
		const startedAt = Date.now();
		let cursor: { timestamp: number; id: string } | null = null;

		for (;;) {
			const candidates = listHqCleanupCandidates(
				cutoffs,
				BATCH_SIZE,
				cursor ?? undefined,
			);
			if (candidates.length === 0) break;

			for (const candidate of candidates) {
				const hqPath = hqPathFromOriginal(candidate.originalPath);
				if (hqPath && safeUnlinkHq(hqPath)) {
					deleted += 1;
				}
			}

			const last = candidates[candidates.length - 1];
			cursor = { timestamp: last.timestamp, id: last.id };

			await yieldToEventLoop();

			if (Date.now() - startedAt >= MAX_RUN_TIME_MS) {
				break;
			}
		}

		if (deleted > 0) {
			logger.info("HQ cleanup finished", {
				reason,
				regularRetentionHours: REGULAR_RETENTION_HOURS,
				sharedRetentionHours: SHARED_RETENTION_HOURS,
				progressFallbackDays: PROGRESS_FALLBACK_DAYS,
				deleted,
			});
		}
	} catch (error) {
		logger.error("HQ cleanup failed", { reason, error });
	} finally {
		isRunning = false;
	}
}

export function startHqRetentionService(): void {
	stopHqRetentionService();

	startupTimeout = setTimeout(() => {
		void runHqCleanup("startup");
	}, STARTUP_DELAY_MS);

	interval = setInterval(() => {
		void runHqCleanup("interval");
	}, RUN_INTERVAL_MS);
}

export function stopHqRetentionService(): void {
	if (startupTimeout) {
		clearTimeout(startupTimeout);
		startupTimeout = null;
	}

	if (interval) {
		clearInterval(interval);
		interval = null;
	}
}

export function triggerHqCleanup(): void {
	void runHqCleanup("manual");
}
