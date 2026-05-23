import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFile = vi.fn();

const screen = {
	getAllDisplays: vi.fn(() => [
		{
			id: 1,
			bounds: { x: 0, y: 0, width: 1440, height: 900 },
			workArea: { x: 0, y: 25, width: 1440, height: 875 },
		},
	]),
};

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
	},
	screen,
}));

vi.mock("node:child_process", () => ({
	execFile,
}));

describe("SystemEventsProvider", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		screen.getAllDisplays.mockReset();
		screen.getAllDisplays.mockReturnValue([
			{
				id: 1,
				bounds: { x: 0, y: 0, width: 1440, height: 900 },
				workArea: { x: 0, y: 25, width: 1440, height: 875 },
			},
		]);
	});

	it("parses a native foreground snapshot and maps it to a display", async () => {
		execFile.mockImplementation((_binary, _args, _options, callback) => {
			callback(
				null,
				JSON.stringify({
					appName: "Cursor",
					bundleId: "com.todesktop.230313mzl4w4u92",
					pid: 123,
					windowTitle: "screencal",
					x: 0,
					y: 25,
					width: 1440,
					height: 875,
				}),
				"",
			);
		});

		const { collectForegroundSnapshot, getAutomationState } = await import(
			"../providers/SystemEventsProvider"
		);

		const snapshot = await collectForegroundSnapshot();

		expect(execFile).toHaveBeenCalledWith(
			"screencap-foreground",
			[],
			{
				maxBuffer: 1024 * 1024,
				timeout: 800,
			},
			expect.any(Function),
		);
		expect(snapshot).toMatchObject({
			app: {
				name: "Cursor",
				bundleId: "com.todesktop.230313mzl4w4u92",
				pid: 123,
			},
			window: {
				title: "screencal",
				displayId: "1",
				isFullscreen: true,
				bounds: {
					x: 0,
					y: 25,
					width: 1440,
					height: 875,
				},
			},
		});
		expect(snapshot?.capturedAt).toEqual(expect.any(Number));
		expect(getAutomationState()).toBe("granted");
	});

	it("returns null when the native payload cannot be parsed", async () => {
		execFile.mockImplementation((_binary, _args, _options, callback) => {
			callback(null, "not-json", "");
		});

		const { collectForegroundSnapshot } = await import(
			"../providers/SystemEventsProvider"
		);

		await expect(collectForegroundSnapshot()).resolves.toBeNull();
	});

	it("returns null when the foreground binary exits with an error", async () => {
		execFile.mockImplementation((_binary, _args, _options, callback) => {
			callback(new Error("exit code 1"), "", "failed");
		});

		const { collectForegroundSnapshot, getLastAutomationError } = await import(
			"../providers/SystemEventsProvider"
		);

		await expect(collectForegroundSnapshot()).resolves.toBeNull();
		expect(getLastAutomationError()).toBe("exit code 1");
	});

	it("returns null when the foreground binary is missing", async () => {
		execFile.mockImplementation((_binary, _args, _options, callback) => {
			callback(new Error("spawn ENOENT"), "", "");
		});

		const { collectForegroundSnapshot, getLastAutomationError } = await import(
			"../providers/SystemEventsProvider"
		);

		await expect(collectForegroundSnapshot()).resolves.toBeNull();
		expect(getLastAutomationError()).toBe("spawn ENOENT");
	});
});
