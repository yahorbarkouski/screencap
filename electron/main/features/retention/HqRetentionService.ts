import { existsSync, unlinkSync } from "node:fs";
import { listHqCleanupCandidates } from "../../infra/db/repositories/EventRepository";
import { createLogger } from "../../infra/log";

const logger = createLogger({ scope: "HqRetention" });

const HOUR_MS = 60 * 60 * 1000;
const HQ_RETENTION_HOURS = 12;
const STARTUP_DELAY_MS = 10_000;
const RUN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RUN_TIME_MS = 1_500;
const BATCH_SIZE = 100;

type HqRetentionRunReason = "startup" | "interval" | "manual";

let interval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let isRunning = false;
let rerunRequested = false;

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

async function runHqCleanup(reason: HqRetentionRunReason): Promise<void> {
	if (isRunning) {
		rerunRequested = true;
		return;
	}

	isRunning = true;
	rerunRequested = false;

	try {
		const cutoff = Date.now() - HQ_RETENTION_HOURS * HOUR_MS;
		let deleted = 0;
		const startedAt = Date.now();

		for (;;) {
			const candidates = listHqCleanupCandidates(cutoff, BATCH_SIZE);
			if (candidates.length === 0) break;

			for (const candidate of candidates) {
				const hqPath = hqPathFromOriginal(candidate.originalPath);
				if (hqPath && safeUnlinkHq(hqPath)) {
					deleted += 1;
				}
			}

			await yieldToEventLoop();

			if (Date.now() - startedAt >= MAX_RUN_TIME_MS) {
				rerunRequested = true;
				break;
			}
		}

		if (deleted > 0) {
			logger.info("HQ cleanup finished", {
				reason,
				retentionHours: HQ_RETENTION_HOURS,
				cutoff,
				deleted,
			});
		}
	} catch (error) {
		logger.error("HQ cleanup failed", { reason, error });
	} finally {
		isRunning = false;
		if (rerunRequested) {
			rerunRequested = false;
			void runHqCleanup("manual");
		}
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
