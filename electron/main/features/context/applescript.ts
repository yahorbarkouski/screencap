import {
	type ChildProcess,
	type ChildProcessWithoutNullStreams,
	exec,
	spawn,
} from "node:child_process";
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

interface PersistentSessionQueuedRequest {
	resolve: (result: AppleScriptResult) => void;
	script: string;
	timeoutMs: number;
}

interface PersistentJxaActiveRequest extends PersistentSessionQueuedRequest {
	id: number;
	markerEnd: string;
	markerStart: string;
	startedAt: number;
	timer: NodeJS.Timeout;
}

class PersistentJxaSession {
	private active: PersistentJxaActiveRequest | null = null;
	private child: ChildProcessWithoutNullStreams | null = null;
	private nextRequestId = 1;
	private readonly queue: PersistentSessionQueuedRequest[] = [];
	private stderrBuffer = "";

	constructor(private readonly sessionKey: string) {}

	async run(script: string, timeoutMs: number): Promise<AppleScriptResult> {
		return await new Promise((resolve) => {
			this.queue.push({ resolve, script, timeoutMs });
			this.pump();
		});
	}

	close(): void {
		const child = this.child;
		this.child = null;
		this.stderrBuffer = "";

		if (child && !child.killed) {
			child.kill("SIGKILL");
		}
	}

	private ensureChild(): ChildProcessWithoutNullStreams {
		if (this.child && this.child.exitCode === null && !this.child.killed) {
			return this.child;
		}

		const child = spawn("osascript", ["-il", "JavaScript"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.child = child;
		this.stderrBuffer = "";

		child.stderr.on("data", (data) => {
			this.stderrBuffer += data.toString();
			this.maybeResolveActiveFromStderr();
		});

		child.stdout.on("data", (data) => {
			const output = data.toString().trim();
			if (!this.active || !output.startsWith("!! Error:")) return;
			this.finishActive({
				success: false,
				output: "",
				error: output.replace(/^!! Error:\s*/, ""),
				timedOut: false,
			});
		});

		child.on("error", (error) => {
			this.handleChildTermination(error.message, false, child);
		});

		child.on("close", (code, signal) => {
			const message =
				this.stderrBuffer.trim() ||
				(signal ? `signal ${signal}` : `exit code ${code ?? 0}`);
			this.handleChildTermination(message, false, child);
		});

		return child;
	}

	private finishActive(result: AppleScriptResult): void {
		const active = this.active;
		if (!active) return;

		clearTimeout(active.timer);
		this.active = null;

		if (perf.enabled) {
			perf.track("persistentJxa.exec", performance.now() - active.startedAt);
			perf.count(
				result.timedOut
					? "persistentJxa.timeout"
					: result.success
						? "persistentJxa.success"
						: "persistentJxa.error",
			);
		}

		active.resolve(result);
		this.pump();
	}

	private handleChildTermination(
		error: string,
		timedOut: boolean,
		child: ChildProcessWithoutNullStreams,
	): void {
		if (this.child !== child) return;

		this.child = null;
		this.stderrBuffer = "";

		if (this.active) {
			this.finishActive({
				success: false,
				output: "",
				error,
				timedOut,
			});
			return;
		}

		this.pump();
	}

	private maybeResolveActiveFromStderr(): void {
		const active = this.active;
		if (!active) return;

		const start = this.stderrBuffer.indexOf(active.markerStart);
		if (start === -1) return;

		const end = this.stderrBuffer.indexOf(
			active.markerEnd,
			start + active.markerStart.length,
		);
		if (end === -1) return;

		const payload = this.stderrBuffer.slice(
			start + active.markerStart.length,
			end,
		);
		this.stderrBuffer = this.stderrBuffer.slice(end + active.markerEnd.length);

		try {
			const parsed = JSON.parse(payload) as {
				error?: unknown;
				ok?: unknown;
				result?: unknown;
			};

			if (parsed.ok !== true) {
				this.finishActive({
					success: false,
					output: "",
					error:
						typeof parsed.error === "string"
							? parsed.error
							: "persistent JXA request failed",
					timedOut: false,
				});
				return;
			}

			const output =
				typeof parsed.result === "string"
					? parsed.result
					: parsed.result == null
						? ""
						: JSON.stringify(parsed.result);

			this.finishActive({
				success: true,
				output,
				error: null,
				timedOut: false,
			});
		} catch (error) {
			this.finishActive({
				success: false,
				output: "",
				error:
					error instanceof Error
						? error.message
						: "failed to parse persistent JXA response",
				timedOut: false,
			});
		}
	}

	private pump(): void {
		if (this.active) return;

		const next = this.queue.shift();
		if (!next) return;

		const child = this.ensureChild();
		const id = this.nextRequestId++;
		const markerStart = `__SCREENCAP_JXA_START_${this.sessionKey}_${id}__`;
		const markerEnd = `__SCREENCAP_JXA_END_${this.sessionKey}_${id}__`;
		const startedAt = perf.enabled ? performance.now() : 0;

		if (perf.enabled) {
			perf.count("persistentJxa.acquire");
			if (this.queue.length > 0) perf.count("persistentJxa.queue");
		}

		this.active = {
			...next,
			id,
			markerEnd,
			markerStart,
			startedAt,
			timer: setTimeout(() => {
				this.handleChildTermination("timeout", true, child);
				if (!child.killed) {
					child.kill("SIGKILL");
				}
			}, next.timeoutMs),
		};

		const wrappedScript = [
			"(() => {",
			"  try {",
			"    const __result = (() => {",
			next.script,
			"    })();",
			`    console.log(${JSON.stringify(markerStart)} + JSON.stringify({ ok: true, result: __result }) + ${JSON.stringify(markerEnd)});`,
			"  } catch (error) {",
			`    console.log(${JSON.stringify(markerStart)} + JSON.stringify({ ok: false, error: String(error) }) + ${JSON.stringify(markerEnd)});`,
			"  }",
			"})()",
		].join("\n");

		child.stdin.write(`${wrappedScript}\n`, (error) => {
			if (!error) return;
			this.handleChildTermination(error.message, false, child);
		});
	}
}

const persistentJxaSessions = new Map<string, PersistentJxaSession>();

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

async function executeJxaScript(
	script: string,
	timeoutMs: number,
): Promise<AppleScriptResult> {
	const startedAt = perf.enabled ? performance.now() : 0;
	return new Promise((resolve) => {
		let resolved = false;
		let stdout = "";
		let stderr = "";

		const child = spawn("osascript", ["-l", "JavaScript", "-"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		const cleanup = () => {
			if (!child.killed) {
				child.kill("SIGKILL");
			}
		};

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				cleanup();
				if (perf.enabled) {
					perf.track("jxa.exec", performance.now() - startedAt);
					perf.count("jxa.timeout");
				}
				resolve({
					success: false,
					output: "",
					error: "timeout",
					timedOut: true,
				});
			}
		}, timeoutMs);

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);

			if (code !== 0) {
				if (perf.enabled) {
					perf.track("jxa.exec", performance.now() - startedAt);
					perf.count("jxa.error");
				}
				resolve({
					success: false,
					output: stdout.trim(),
					error: stderr.trim() || `exit code ${code}`,
					timedOut: false,
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
				perf.track("jxa.exec", performance.now() - startedAt);
				perf.count("jxa.success");
			}
		});

		child.on("error", (error) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			if (perf.enabled) {
				perf.track("jxa.exec", performance.now() - startedAt);
				perf.count("jxa.error");
			}
			resolve({
				success: false,
				output: "",
				error: error.message,
				timedOut: false,
			});
		});

		child.stdin.write(script);
		child.stdin.end();
	});
}

export async function runJxa(
	script: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AppleScriptResult> {
	if (perf.enabled) {
		perf.count("jxa.acquire");
		if (globalState.inFlightCount >= MAX_CONCURRENT_CALLS)
			perf.count("jxa.queue");
	}
	await acquireSlot();

	try {
		return await executeJxaScript(script, timeoutMs);
	} finally {
		releaseSlot();
	}
}

export async function runPersistentJxa(
	sessionKey: string,
	script: string,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AppleScriptResult> {
	let session = persistentJxaSessions.get(sessionKey);
	if (!session) {
		session = new PersistentJxaSession(sessionKey);
		persistentJxaSessions.set(sessionKey, session);
	}

	return await session.run(script, timeoutMs);
}

export function closePersistentJxaSessions(): void {
	for (const session of persistentJxaSessions.values()) {
		session.close();
	}
	persistentJxaSessions.clear();
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

process.once("exit", () => {
	closePersistentJxaSessions();
});
