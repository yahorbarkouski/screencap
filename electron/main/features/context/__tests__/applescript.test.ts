import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.fn();
const spawn = vi.fn();

vi.mock("node:child_process", () => ({
	exec,
	spawn,
}));

interface MockInteractiveChild extends EventEmitter {
	exitCode: number | null;
	killed: boolean;
	kill: ReturnType<typeof vi.fn>;
	stderr: EventEmitter;
	stdin: Writable;
	stdout: EventEmitter;
}

function createInteractiveChild(
	onWrite?: (chunk: string, child: MockInteractiveChild) => void,
): MockInteractiveChild {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = new EventEmitter() as MockInteractiveChild;

	child.exitCode = null;
	child.killed = false;
	child.stdout = stdout;
	child.stderr = stderr;
	child.kill = vi.fn((signal?: string) => {
		child.killed = true;
		child.exitCode = signal ? null : 0;
		child.emit("close", child.exitCode, signal ?? null);
		return true;
	});
	child.stdin = new Writable({
		write(chunk, _encoding, callback) {
			onWrite?.(chunk.toString(), child);
			callback();
		},
	});

	return child;
}

describe("runPersistentJxa", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(async () => {
		const { closePersistentJxaSessions } = await import("../applescript");
		closePersistentJxaSessions();
		vi.useRealTimers();
	});

	it("reuses a single interactive osascript session across requests", async () => {
		spawn.mockImplementation(() =>
			createInteractiveChild((chunk, child) => {
				const start = chunk.match(/__SCREENCAP_JXA_START_[^"]+__/);
				const end = chunk.match(/__SCREENCAP_JXA_END_[^"]+__/);
				const result = chunk.includes('"second"') ? "second" : "first";

				if (!start || !end) return;
				queueMicrotask(() => {
					child.stderr.emit(
						"data",
						`${start[0]}${JSON.stringify({ ok: true, result })}${end[0]}`,
					);
				});
			}),
		);

		const { runPersistentJxa } = await import("../applescript");

		await expect(
			runPersistentJxa("foreground", 'return "first";'),
		).resolves.toMatchObject({
			success: true,
			output: "first",
		});

		await expect(
			runPersistentJxa("foreground", 'return "second";'),
		).resolves.toMatchObject({
			success: true,
			output: "second",
		});

		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("times out and restarts the session", async () => {
		const children: MockInteractiveChild[] = [];

		spawn.mockImplementation(() => {
			const child = createInteractiveChild((chunk, currentChild) => {
				const start = chunk.match(/__SCREENCAP_JXA_START_[^"]+__/);
				const end = chunk.match(/__SCREENCAP_JXA_END_[^"]+__/);

				if (!start || !end || children.length === 1) return;
				queueMicrotask(() => {
					currentChild.stderr.emit(
						"data",
						`${start[0]}${JSON.stringify({ ok: true, result: "recovered" })}${end[0]}`,
					);
				});
			});
			children.push(child);
			return child;
		});

		const { runPersistentJxa } = await import("../applescript");

		const timedOutPromise = runPersistentJxa(
			"foreground",
			'return "never";',
			50,
		);
		await vi.advanceTimersByTimeAsync(50);

		await expect(timedOutPromise).resolves.toMatchObject({
			success: false,
			error: "timeout",
			timedOut: true,
		});

		await expect(
			runPersistentJxa("foreground", 'return "recovered";'),
		).resolves.toMatchObject({
			success: true,
			output: "recovered",
		});

		expect(spawn).toHaveBeenCalledTimes(2);
		expect(children[0]?.kill).toHaveBeenCalledWith("SIGKILL");
	});
});
