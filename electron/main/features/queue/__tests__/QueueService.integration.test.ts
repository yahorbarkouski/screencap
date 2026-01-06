import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, initTestDb } from "../../../testUtils/db";
import { createTempDir } from "../../../testUtils/tmp";

let userDataDir = "";
let cleanup: (() => Promise<void>) | null = null;
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataDir;
			throw new Error("Unsupported app.getPath");
		},
	},
	safeStorage: {
		isEncryptionAvailable: () => false,
		encryptString: (value: string) => Buffer.from(value, "utf8"),
		decryptString: (buf: Buffer) => buf.toString("utf8"),
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

function writeFile(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "x");
}

async function runQueueOnce(): Promise<void> {
	const { triggerQueueProcess } = await import("../QueueService");
	const p = triggerQueueProcess();
	await vi.runAllTimersAsync();
	await p;
}

describe("QueueService (integration)", () => {
	beforeEach(async () => {
		const tmp = await createTempDir("screencap-queue-int-");
		userDataDir = tmp.dir;
		cleanup = tmp.cleanup;
		vi.resetModules();
		await initTestDb();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(0));
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(async () => {
		consoleErrorSpy?.mockRestore();
		consoleWarnSpy?.mockRestore();
		consoleErrorSpy = null;
		consoleWarnSpy = null;
		vi.useRealTimers();
		await closeTestDb();
		await cleanup?.();
		userDataDir = "";
		cleanup = null;
	});

	it("marks failed and removes from queue when screenshot file is missing", async () => {
		const { insertEvent, getEventById } = await import(
			"../../../infra/db/repositories/EventRepository"
		);
		const { addToQueue, getQueueItems } = await import(
			"../../../infra/db/repositories/QueueRepository"
		);
		const { getOriginalsDir } = await import("../../../infra/paths");

		const originals = getOriginalsDir();
		const originalPath = join(originals, "e_missing.webp");

		insertEvent({
			id: "e_missing",
			timestamp: 0,
			endTimestamp: 0,
			displayId: "1",
			originalPath,
			status: "pending",
		});

		addToQueue("e_missing");
		expect(getQueueItems()).toHaveLength(1);

		await runQueueOnce();

		expect(getQueueItems()).toHaveLength(0);
		expect(getEventById("e_missing")?.status).toBe("failed");
	});

	it("finalizes locally when automation policy skips LLM", async () => {
		const { insertEvent, getEventById } = await import(
			"../../../infra/db/repositories/EventRepository"
		);
		const { addToQueue, getQueueItems } = await import(
			"../../../infra/db/repositories/QueueRepository"
		);
		const { getOriginalsDir } = await import("../../../infra/paths");
		const { getSettings, setSettings } = await import(
			"../../../infra/settings"
		);

		const bundleId = "com.example.app";
		const base = getSettings();
		setSettings({
			...base,
			automationRules: {
				...base.automationRules,
				apps: {
					...base.automationRules.apps,
					[bundleId]: { llm: "skip" },
				},
			},
		});

		const originals = getOriginalsDir();
		const originalPath = join(originals, "e_skip.webp");
		const highResPath = join(originals, "e_skip.hq.png");
		writeFile(originalPath);
		writeFile(highResPath);

		insertEvent({
			id: "e_skip",
			timestamp: 0,
			endTimestamp: 0,
			displayId: "1",
			appBundleId: bundleId,
			appName: "ExampleApp",
			originalPath,
			status: "pending",
		});

		addToQueue("e_skip");
		expect(getQueueItems()).toHaveLength(1);
		expect(existsSync(highResPath)).toBe(true);

		await runQueueOnce();

		expect(getQueueItems()).toHaveLength(0);
		const evt = getEventById("e_skip");
		expect(evt?.status).toBe("completed");
		expect(evt?.caption).toContain("ExampleApp");
		expect(existsSync(highResPath)).toBe(true);
	});

	it("removes queue item after max attempts", async () => {
		const { insertEvent, getEventById } = await import(
			"../../../infra/db/repositories/EventRepository"
		);
		const { addToQueue, getQueueItems } = await import(
			"../../../infra/db/repositories/QueueRepository"
		);
		const { getOriginalsDir } = await import("../../../infra/paths");

		const originals = getOriginalsDir();
		const unreadableDir = join(originals, "unreadable");
		mkdirSync(unreadableDir, { recursive: true });

		const highResPath = join(originals, "e_retry.hq.png");
		writeFile(highResPath);

		insertEvent({
			id: "e_retry",
			timestamp: 0,
			endTimestamp: 0,
			displayId: "1",
			originalPath: unreadableDir,
			status: "pending",
		});

		addToQueue("e_retry");

		await runQueueOnce();
		expect(getQueueItems()[0]?.attempts).toBe(1);
		expect(getEventById("e_retry")?.status).toBe("failed");

		vi.setSystemTime(new Date(30_001));
		await runQueueOnce();
		expect(getQueueItems()[0]?.attempts).toBe(2);

		vi.setSystemTime(new Date(150_002));
		await runQueueOnce();

		expect(getQueueItems()).toHaveLength(0);
		expect(existsSync(highResPath)).toBe(true);
	});
});
