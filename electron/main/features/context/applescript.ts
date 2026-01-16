import { type ChildProcess, exec } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createPerfTracker } from "../../infra/log/perf";

const DEFAULT_TIMEOUT_MS = 800;
const MAX_CONCURRENT_CALLS = 5;

export interface AppleScriptResult {
	success: boolean;
	output: string;
	error: string | null;
	timedOut: boolean;
}

const globalState = {
	inFlightCount: 0,
	queue: [] as Array<() => void>,
};

const perf = createPerfTracker("Perf.AppleScript");

function acquireSlot(): Promise<void> {
	return new Promise((resolve) => {
		if (globalState.inFlightCount < MAX_CONCURRENT_CALLS) {
			globalState.inFlightCount++;
			resolve();
		} else {
			globalState.queue.push(() => {
				globalState.inFlightCount++;
				resolve();
			});
		}
	});
}

function releaseSlot(): void {
	globalState.inFlightCount--;
	const next = globalState.queue.shift();
	if (next) next();
}

async function executeScript(
	script: string,
	timeoutMs: number,
): Promise<AppleScriptResult> {
	const startedAt = perf.enabled ? performance.now() : 0;
	return new Promise((resolve) => {
		let resolved = false;
		let child: ChildProcess | null = null;

		const cleanup = () => {
			if (child && !child.killed) {
				child.kill("SIGKILL");
			}
		};

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				cleanup();
				if (perf.enabled) {
					perf.track("applescript.exec", performance.now() - startedAt);
					perf.count("applescript.timeout");
				}
				resolve({
					success: false,
					output: "",
					error: "timeout",
					timedOut: true,
				});
			}
		}, timeoutMs);

		child = exec(
			`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
			{ timeout: timeoutMs, killSignal: "SIGKILL" },
			(error, stdout, stderr) => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timer);

				if (error) {
					const timedOut = error.killed || error.signal === "SIGKILL";
					if (perf.enabled) {
						perf.track("applescript.exec", performance.now() - startedAt);
						perf.count(timedOut ? "applescript.timeout" : "applescript.error");
					}
					resolve({
						success: false,
						output: stdout.trim(),
						error: timedOut ? "timeout" : stderr.trim() || error.message,
						timedOut,
					});
					return;
				}

				resolve({
					success: true,
					output: stdout.trim(),
					error: null,
					timedOut: false,
				});
				if (perf.enabled) {
					perf.track("applescript.exec", performance.now() - startedAt);
					perf.count("applescript.success");
				}
			},
		);
	});
}

export async function runAppleScript(
	script: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AppleScriptResult> {
	if (perf.enabled) {
		perf.count("applescript.acquire");
		if (globalState.inFlightCount >= MAX_CONCURRENT_CALLS)
			perf.count("applescript.queue");
	}
	await acquireSlot();

	try {
		return await executeScript(script, timeoutMs);
	} finally {
		releaseSlot();
	}
}

export function isAutomationDenied(error: string | null): boolean {
	if (!error) return false;
	const denialPatterns = [
		"not authorized",
		"not allowed to send",
		"access not allowed",
		"assistive access",
		"System Events got an error",
	];
	const lower = error.toLowerCase();
	return denialPatterns.some((p) => lower.includes(p.toLowerCase()));
}

export function getAppleScriptHealth(): {
	inFlight: number;
	queueLength: number;
} {
	return {
		inFlight: globalState.inFlightCount,
		queueLength: globalState.queue.length,
	};
}
