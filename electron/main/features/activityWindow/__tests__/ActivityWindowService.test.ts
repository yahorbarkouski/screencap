import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const powerMonitor = { getSystemIdleTime: vi.fn(() => 0) };
const screen = { getPrimaryDisplay: vi.fn(() => ({ id: 1 })) };

vi.mock("electron", () => ({
	powerMonitor,
	screen,
}));

const mkdir = vi.fn(async () => undefined);
const readdir = vi.fn(async () => []);
const rename = vi.fn(async () => undefined);
const rm = vi.fn(async () => undefined);
vi.mock("node:fs/promises", () => ({
	mkdir,
	readdir,
	rename,
	rm,
}));

vi.mock("uuid", () => ({
	v4: vi.fn(() => "window-id"),
}));

vi.mock("../../../infra/paths", () => ({
	getOriginalsDir: () => "/tmp/originals",
	getTempCapturesDir: () => "/tmp/temp-captures",
	getThumbnailsDir: () => "/tmp/thumbnails",
}));

vi.mock("../../../infra/settings", () => ({
	getSettings: () => ({ automationRules: { apps: {}, hosts: {} } }),
}));

vi.mock("../../automationRules", () => ({
	evaluateAutomationPolicy: () => ({
		capture: "allow",
		llm: "allow",
		overrides: {},
	}),
}));

const captureAllDisplays = vi.fn();
vi.mock("../../capture", () => ({
	captureAllDisplays,
}));

const collectActivityContext = vi.fn();
const collectForegroundSnapshot = vi.fn();
vi.mock("../../context", () => ({
	collectActivityContext,
	collectForegroundSnapshot,
}));

vi.mock("../../context/providers", () => ({
	chromiumProvider: {
		supports: vi.fn(() => false),
	},
	safariProvider: {
		supports: vi.fn(() => false),
	},
}));

describe("ActivityWindowService", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

		collectForegroundSnapshot.mockImplementation(async () => ({
			capturedAt: Date.now(),
			app: {
				bundleId: "com.test.app",
				name: "Test App",
			},
			window: {
				displayId: "1",
				title: "Test Window",
				isFullscreen: false,
			},
		}));

		collectActivityContext.mockImplementation(async () => ({
			key: "1::app:com.test.app",
			provider: "test",
			confidence: 1,
			app: {
				bundleId: "com.test.app",
				name: "Test App",
			},
			window: {
				displayId: "1",
				title: "Test Window",
				isFullscreen: false,
			},
			url: null,
			content: null,
		}));
	});

	afterEach(async () => {
		try {
			const { stopActivityWindowTracking } = await import(
				"../ActivityWindowService"
			);
			stopActivityWindowTracking();
		} catch {}
		vi.useRealTimers();
	});

	it("releases stale in-flight candidate captures so finalization can recover", async () => {
		captureAllDisplays.mockImplementationOnce(
			() => new Promise(() => undefined),
		);
		captureAllDisplays.mockResolvedValue([]);

		const { finalizeActivityWindow, startActivityWindowTracking } =
			await import("../ActivityWindowService");

		startActivityWindowTracking();
		await Promise.resolve();
		await Promise.resolve();

		await vi.advanceTimersByTimeAsync(12_000);
		expect(captureAllDisplays).toHaveBeenCalledTimes(1);

		const finalizePromise = finalizeActivityWindow(Date.now());

		await vi.advanceTimersByTimeAsync(60_000);

		await expect(finalizePromise).resolves.toMatchObject({
			kind: "skip",
			reason: "no-candidate",
		});
		expect(captureAllDisplays).toHaveBeenCalledTimes(2);
	});
});
