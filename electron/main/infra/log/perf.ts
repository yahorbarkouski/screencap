import { performance } from "node:perf_hooks";
import { createLogger } from "./logger";

type TimingStats = {
	count: number;
	totalMs: number;
	maxMs: number;
	lastMs: number;
};

type CounterStats = {
	count: number;
};

export type PerfTracker = {
	enabled: boolean;
	track: (key: string, ms: number) => void;
	count: (key: string, delta?: number) => void;
};

function readEnabled(): boolean {
	const value = process.env.PERF_DIAG?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

export function createPerfTracker(
	scope: string,
	intervalMs: number = 60_000,
): PerfTracker {
	const enabled = readEnabled();
	const logger = createLogger({ scope });
	const timings = new Map<string, TimingStats>();
	const counters = new Map<string, CounterStats>();
	let lastReportAt = performance.now();

	const maybeReport = (now: number) => {
		if (now - lastReportAt < intervalMs) return;

		const timingEntries = Array.from(timings.entries()).map(([key, stat]) => ({
			key,
			count: stat.count,
			avgMs: Math.round(stat.totalMs / Math.max(1, stat.count)),
			maxMs: Math.round(stat.maxMs),
			lastMs: Math.round(stat.lastMs),
		}));

		const counterEntries = Array.from(counters.entries()).map(([key, stat]) => ({
			key,
			count: stat.count,
		}));

		logger.info("Perf summary", {
			windowMs: Math.round(now - lastReportAt),
			timings: timingEntries,
			counts: counterEntries,
		});

		timings.clear();
		counters.clear();
		lastReportAt = now;
	};

	const track = (key: string, ms: number) => {
		if (!enabled) return;
		const now = performance.now();
		const stat = timings.get(key) ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
			lastMs: 0,
		};
		stat.count += 1;
		stat.totalMs += ms;
		stat.maxMs = Math.max(stat.maxMs, ms);
		stat.lastMs = ms;
		timings.set(key, stat);
		maybeReport(now);
	};

	const count = (key: string, delta: number = 1) => {
		if (!enabled) return;
		const now = performance.now();
		const stat = counters.get(key) ?? { count: 0 };
		stat.count += delta;
		counters.set(key, stat);
		maybeReport(now);
	};

	return { enabled, track, count };
}
