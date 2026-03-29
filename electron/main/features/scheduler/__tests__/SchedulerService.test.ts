import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const powerMonitor = { getSystemIdleTime: vi.fn(() => 0) };
const screen = { getPrimaryDisplay: vi.fn(() => ({ id: 1 })) };

vi.mock("electron", () => ({
	powerMonitor,
	screen,
	BrowserWindow: { getAllWindows: () => [] },
}));

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};
vi.mock("../../../infra/log", () => ({
	createLogger: () => logger,
}));

const updateEvent = vi.fn();
vi.mock("../../../infra/db/repositories/EventRepository", () => ({
	updateEvent,
}));

const broadcastPermissionRequired = vi.fn();
const broadcastEventUpdated = vi.fn();
vi.mock("../../../infra/windows", () => ({
	broadcastPermissionRequired,
	broadcastEventUpdated,
}));

const checkScreenCapturePermission = vi.fn(() => true);
vi.mock("../../permissions", () => ({
	checkScreenCapturePermission,
}));

const captureAllDisplays = vi.fn();
vi.mock("../../capture", () => ({
	captureAllDisplays,
}));

const processCaptureGroup = vi.fn();
vi.mock("../../events", () => ({
	processCaptureGroup,
}));

const getLastKnownCandidate = vi.fn(() => null);
const discardActivityWindow = vi.fn();
const finalizeActivityWindow = vi.fn();
const startActivityWindowTracking = vi.fn();
const stopActivityWindowTracking = vi.fn();
vi.mock("../../activityWindow", () => ({
	discardActivityWindow,
	finalizeActivityWindow,
	getLastKnownCandidate,
	startActivityWindowTracking,
	stopActivityWindowTracking,
}));

vi.mock("../../../infra/settings", () => ({
	getCaptureInterval: () => 5,
	getSettings: () => ({ automationRules: { apps: {}, hosts: {} } }),
}));

vi.mock("../../automationRules", () => ({
	evaluateAutomationPolicy: () => ({
		capture: "allow",
		llm: "allow",
		overrides: {},
	}),
}));

vi.mock("../../context", () => ({
	collectActivityContext: () => Promise.resolve(null),
}));

describe("SchedulerService (manual capture)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("broadcasts permission required and does not capture when permission is missing", async () => {
		checkScreenCapturePermission.mockReturnValue(false);

		const { triggerManualCaptureWithPrimaryDisplay } = await import(
			"../SchedulerService"
		);

		const res = await triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "default",
		});

		expect(res).toEqual({ merged: false, eventId: null });
		expect(broadcastPermissionRequired).toHaveBeenCalledTimes(1);
		expect(captureAllDisplays).not.toHaveBeenCalled();
	});

	it("passes enqueueToLlmQueue=false and allowMerge=false for project_progress intent and marks manual progress", async () => {
		checkScreenCapturePermission.mockReturnValue(true);
		captureAllDisplays.mockResolvedValue([
			{
				id: "s1",
				timestamp: 1,
				displayId: "D1",
				thumbnailPath: "/tmp/t.webp",
				originalPath: "/tmp/o.webp",
				stableHash: "0".repeat(16),
				detailHash: "0".repeat(64),
				width: 100,
				height: 100,
			},
		]);
		processCaptureGroup.mockResolvedValue({ merged: false, eventId: "e1" });

		const { triggerManualCaptureWithPrimaryDisplay } = await import(
			"../SchedulerService"
		);

		const res = await triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "project_progress",
		});

		expect(res).toEqual({ merged: false, eventId: "e1" });
		expect(processCaptureGroup).toHaveBeenCalledWith(
			expect.objectContaining({
				enqueueToLlmQueue: false,
				allowMerge: false,
				primaryDisplayId: "D1",
			}),
		);
		expect(updateEvent).toHaveBeenCalledWith("e1", {
			projectProgress: 1,
			projectProgressEvidence: "manual",
		});
		expect(broadcastEventUpdated).toHaveBeenCalledWith("e1");
	});

	it("returns without creating event when capture yields no displays", async () => {
		checkScreenCapturePermission.mockReturnValue(true);
		captureAllDisplays.mockResolvedValue([]);

		const { triggerManualCaptureWithPrimaryDisplay } = await import(
			"../SchedulerService"
		);

		const res = await triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "default",
		});

		expect(res).toEqual({ merged: false, eventId: null });
		expect(processCaptureGroup).not.toHaveBeenCalled();
	});

	it("uses the current scheduler interval for manual capture (intervalMs propagation)", async () => {
		checkScreenCapturePermission.mockReturnValue(true);
		captureAllDisplays.mockResolvedValue([
			{
				id: "s1",
				timestamp: 1,
				displayId: "D1",
				thumbnailPath: "/tmp/t.webp",
				originalPath: "/tmp/o.webp",
				stableHash: "0".repeat(16),
				detailHash: "0".repeat(64),
				width: 100,
				height: 100,
			},
		]);
		processCaptureGroup.mockResolvedValue({ merged: false, eventId: "e1" });

		const {
			startScheduler,
			stopScheduler,
			triggerManualCaptureWithPrimaryDisplay,
		} = await import("../SchedulerService");

		startScheduler(1);
		await triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "default",
		});
		stopScheduler();

		expect(processCaptureGroup).toHaveBeenCalledWith(
			expect.objectContaining({
				intervalMs: 60_000,
			}),
		);
		expect(startActivityWindowTracking).toHaveBeenCalledTimes(1);
		expect(stopActivityWindowTracking).toHaveBeenCalledTimes(2);
	});

	it("logs scheduled tick failures instead of leaking an unhandled rejection", async () => {
		vi.useFakeTimers();
		checkScreenCapturePermission.mockReturnValue(true);
		const error = new Error("finalize failed");
		finalizeActivityWindow.mockRejectedValue(error);

		const { startScheduler, stopScheduler } = await import(
			"../SchedulerService"
		);

		startScheduler(1);
		await vi.advanceTimersByTimeAsync(60_000);
		stopScheduler();

		expect(logger.error).toHaveBeenCalledWith("Scheduler tick failed", error);
	});

	it("force releases a stale manual capture lease so the next manual capture can proceed", async () => {
		vi.useFakeTimers();

		checkScreenCapturePermission.mockReturnValue(true);
		captureAllDisplays.mockImplementationOnce(
			() => new Promise(() => undefined),
		);
		captureAllDisplays.mockResolvedValue([
			{
				id: "s2",
				timestamp: 2,
				displayId: "D1",
				thumbnailPath: "/tmp/t2.webp",
				originalPath: "/tmp/o2.webp",
				stableHash: "1".repeat(16),
				detailHash: "1".repeat(64),
				width: 100,
				height: 100,
			},
		]);
		processCaptureGroup.mockResolvedValue({ merged: false, eventId: "e2" });

		const { triggerManualCaptureWithPrimaryDisplay } = await import(
			"../SchedulerService"
		);

		void triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "default",
		});

		const secondCapturePromise = triggerManualCaptureWithPrimaryDisplay({
			primaryDisplayId: "D1",
			intent: "default",
		});

		await vi.advanceTimersByTimeAsync(60_000);

		await expect(secondCapturePromise).resolves.toEqual({
			merged: false,
			eventId: "e2",
		});
		expect(captureAllDisplays).toHaveBeenCalledTimes(2);
	});

	it("recovers scheduled captures after a stale windowed capture lease expires", async () => {
		vi.useFakeTimers();

		finalizeActivityWindow
			.mockImplementationOnce(() => new Promise(() => undefined))
			.mockResolvedValue({
				kind: "skip",
				windowStart: 0,
				windowEnd: 0,
				reason: "no-data",
			});
		discardActivityWindow.mockResolvedValue(undefined);

		const { startScheduler, stopScheduler } = await import(
			"../SchedulerService"
		);

		startScheduler(1);
		await vi.advanceTimersByTimeAsync(181_000);
		stopScheduler();

		expect(finalizeActivityWindow.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});
