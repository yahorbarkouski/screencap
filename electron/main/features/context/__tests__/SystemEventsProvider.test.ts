import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const screen = {
	getAllDisplays: vi.fn(() => [
		{
			id: 1,
			bounds: { x: 0, y: 0, width: 1440, height: 900 },
			workArea: { x: 0, y: 25, width: 1440, height: 875 },
		},
	]),
};

const runPersistentJxa = vi.fn();

vi.mock("electron", () => ({
	screen,
}));

vi.mock("../applescript", () => ({
	runPersistentJxa,
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
		runPersistentJxa.mockResolvedValue({
			success: true,
			output: JSON.stringify({
				appName: "Cursor",
				bundleId: "com.todesktop.230313mzl4w4u92",
				pid: 123,
				windowTitle: "screencal",
				x: 0,
				y: 25,
				width: 1440,
				height: 875,
			}),
			error: null,
			timedOut: false,
		});

		const { collectForegroundSnapshot, getAutomationState } = await import(
			"../providers/SystemEventsProvider"
		);

		const snapshot = await collectForegroundSnapshot();

		expect(runPersistentJxa).toHaveBeenCalledWith(
			"foreground-snapshot",
			expect.stringContaining(
				"NSWorkspace.sharedWorkspace.frontmostApplication",
			),
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
		runPersistentJxa.mockResolvedValue({
			success: true,
			output: "not-json",
			error: null,
			timedOut: false,
		});

		const { collectForegroundSnapshot } = await import(
			"../providers/SystemEventsProvider"
		);

		await expect(collectForegroundSnapshot()).resolves.toBeNull();
	});
});
