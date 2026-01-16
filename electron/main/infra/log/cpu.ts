import { app } from "electron";
import { createLogger } from "./logger";

type CpuSamplerOptions = {
	intervalMs?: number;
	topN?: number;
};

function isEnabled(): boolean {
	const value = process.env.PERF_DIAG?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

const logger = createLogger({ scope: "Perf.CPU" });

let timer: NodeJS.Timeout | null = null;

export function startCpuSampler(options?: CpuSamplerOptions): void {
	if (!isEnabled()) return;
	if (timer) return;

	const intervalMs = Math.max(1000, options?.intervalMs ?? 10_000);
	const topN = Math.max(1, options?.topN ?? 5);

	timer = setInterval(() => {
		const metrics = app.getAppMetrics();
		const sorted = [...metrics].sort(
			(a, b) => b.cpu.percentCPUUsage - a.cpu.percentCPUUsage,
		);
		const top = sorted.slice(0, topN).map((m) => ({
			pid: m.pid,
			type: m.type,
			cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
			idleWakeups: Math.round((m.cpu as { idleWakeupsPerSecond?: number })
				.idleWakeupsPerSecond ?? 0),
		}));
		logger.info("CPU sample", { top });
	}, intervalMs);

	logger.info("CPU sampler started", { intervalMs, topN });
}

export function stopCpuSampler(): void {
	if (!timer) return;
	clearInterval(timer);
	timer = null;
	logger.info("CPU sampler stopped");
}
