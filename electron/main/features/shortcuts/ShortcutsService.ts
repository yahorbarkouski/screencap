import { app, globalShortcut, type Rectangle, screen } from "electron";
import { getLogicalDayStart } from "../../../shared/dayBoundary";
import { IpcEvents } from "../../../shared/ipc";
import type { Settings, ShortcutSettings } from "../../../shared/types";
import {
	getCapturePopupWindow,
	sendEventIdToPopup,
	sendPreviewToPopup,
	showCapturePopupWindow,
} from "../../app/capturePopup";
import { getPopupWindow, hidePopupWindow } from "../../app/popup";
import { getMainWindow, showMainWindow } from "../../app/window";
import { createLogger } from "../../infra/log";
import { broadcast } from "../../infra/windows";
import { getLastKnownCandidate } from "../activityWindow";
import { captureInstant, processInstantCapture } from "../capture";
import { processCaptureGroup } from "../events";
import { checkScreenCapturePermission } from "../permissions";
import { triggerManualCaptureWithPrimaryDisplay } from "../scheduler";

const logger = createLogger({ scope: "Shortcuts" });

let registered = new Set<string>();
let started = false;
let suspended = false;
let lastSettings: Settings | null = null;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAccelerator(value: string | null | undefined): string | null {
	const v = value?.trim() ?? "";
	return v.length > 0 ? v : null;
}

function cursorAnchor(): Rectangle {
	const p = screen.getCursorScreenPoint();
	return { x: p.x, y: p.y, width: 1, height: 1 };
}

function getPrimaryDisplayIdFromCursor(): string {
	const point = screen.getCursorScreenPoint();
	return String(screen.getDisplayNearestPoint(point).id);
}

function unregisterRegistered(): void {
	for (const accelerator of registered) {
		try {
			globalShortcut.unregister(accelerator);
		} catch {}
	}
	registered = new Set();
}

async function withWindowsHidden<T>(
	run: () => Promise<T>,
	options?: {
		restoreMain?: boolean;
		restoreMainFocus?: boolean;
		restoreTrayPopup?: boolean;
		restoreCapturePopup?: boolean;
	},
): Promise<T> {
	const restoreMain = options?.restoreMain ?? true;
	const restoreMainFocus = options?.restoreMainFocus ?? true;
	const restoreTrayPopup = options?.restoreTrayPopup ?? true;
	const restoreCapturePopup = options?.restoreCapturePopup ?? true;
	const main = getMainWindow();
	const trayPopup = getPopupWindow();
	const capturePopup = getCapturePopupWindow();

	const mainWasVisible = !!main && !main.isDestroyed() && main.isVisible();
	const mainWasFocused = !!main && !main.isDestroyed() && main.isFocused();

	const trayWasVisible =
		!!trayPopup && !trayPopup.isDestroyed() && trayPopup.isVisible();

	const captureWasVisible =
		!!capturePopup && !capturePopup.isDestroyed() && capturePopup.isVisible();
	const captureWasFocused =
		!!capturePopup && !capturePopup.isDestroyed() && capturePopup.isFocused();

	if (trayWasVisible) hidePopupWindow();
	if (captureWasVisible) capturePopup?.hide();
	if (mainWasVisible) main?.hide();

	if (trayWasVisible || captureWasVisible || mainWasVisible) {
		await sleep(160);
	}

	try {
		return await run();
	} finally {
		if (
			restoreTrayPopup &&
			trayWasVisible &&
			trayPopup &&
			!trayPopup.isDestroyed()
		) {
			trayPopup.showInactive();
			trayPopup.moveTop();
		}

		if (
			restoreCapturePopup &&
			captureWasVisible &&
			capturePopup &&
			!capturePopup.isDestroyed()
		) {
			if (captureWasFocused) {
				capturePopup.show();
				capturePopup.focus();
			} else {
				capturePopup.showInactive();
			}
		}

		if (restoreMain && mainWasVisible && main && !main.isDestroyed()) {
			if (restoreMainFocus && mainWasFocused) {
				showMainWindow();
			} else {
				main.showInactive();
			}
		}
	}
}

async function handleCaptureNow(): Promise<void> {
	const popup = getPopupWindow();
	if (
		popup &&
		!popup.isDestroyed() &&
		popup.isVisible() &&
		!popup.webContents.isLoadingMainFrame()
	) {
		popup.webContents.send(IpcEvents.ShortcutCaptureNow);
		return;
	}

	const primaryDisplayId = getPrimaryDisplayIdFromCursor();
	await withWindowsHidden(async () => {
		await triggerManualCaptureWithPrimaryDisplay({ primaryDisplayId });
	});
}

async function handleCaptureProjectProgress(): Promise<void> {
	if (!checkScreenCapturePermission()) {
		logger.warn("No screen capture permission");
		return;
	}

	const lastKnown = getLastKnownCandidate();
	const context = lastKnown?.context ?? null;

	const primaryDisplayId = getPrimaryDisplayIdFromCursor();
	const anchor = cursorAnchor();

	const instantCapture = await withWindowsHidden(
		() => captureInstant(primaryDisplayId),
		{
			restoreMain: false,
			restoreTrayPopup: false,
			restoreCapturePopup: false,
		},
	);

	if (!instantCapture) {
		logger.warn("No captures available");
		return;
	}

	showCapturePopupWindow(anchor);
	await sendPreviewToPopup({
		imageBase64: instantCapture.previewBase64,
		project: null,
	});

	const captures = await processInstantCapture(instantCapture, {
		highResDisplayId: primaryDisplayId,
	});

	const result = await processCaptureGroup({
		captures,
		intervalMs: 5 * 60 * 1000,
		primaryDisplayId,
		context,
		enqueueToLlmQueue: false,
		allowMerge: false,
	});

	if (result.eventId) {
		const { updateEvent } = await import(
			"../../infra/db/repositories/EventRepository"
		);
		const { broadcastEventUpdated } = await import("../../infra/windows");

		updateEvent(result.eventId, {
			projectProgress: 1,
			projectProgressEvidence: "manual",
		});
		broadcastEventUpdated(result.eventId);
		sendEventIdToPopup(result.eventId);
	}
}

async function handleEndOfDay(): Promise<void> {
	showMainWindow();
	broadcast(IpcEvents.ShortcutEndOfDay, {
		dayStart: getLogicalDayStart(Date.now()),
	});
}

function registerShortcut(
	accelerator: string,
	handler: () => void | Promise<void>,
): boolean {
	try {
		const ok = globalShortcut.register(accelerator, () => {
			void Promise.resolve(handler()).catch((error) => {
				logger.error("Shortcut handler failed", { accelerator, error });
			});
		});
		return ok;
	} catch (error) {
		logger.warn("Failed to register shortcut", { accelerator, error });
		return false;
	}
}

function buildBindings(shortcuts: ShortcutSettings): Array<{
	action: keyof ShortcutSettings;
	accelerator: string;
	handler: () => void | Promise<void>;
}> {
	const captureNow = normalizeAccelerator(shortcuts.captureNow);
	const captureProjectProgress = normalizeAccelerator(
		shortcuts.captureProjectProgress,
	);
	const endOfDay = normalizeAccelerator(shortcuts.endOfDay);

	const bindings: Array<{
		action: keyof ShortcutSettings;
		accelerator: string;
		handler: () => void | Promise<void>;
	}> = [];

	if (captureNow) {
		bindings.push({
			action: "captureNow",
			accelerator: captureNow,
			handler: handleCaptureNow,
		});
	}

	if (captureProjectProgress) {
		bindings.push({
			action: "captureProjectProgress",
			accelerator: captureProjectProgress,
			handler: handleCaptureProjectProgress,
		});
	}

	if (endOfDay) {
		bindings.push({
			action: "endOfDay",
			accelerator: endOfDay,
			handler: handleEndOfDay,
		});
	}

	return bindings;
}

export function startShortcuts(settings: Settings): void {
	if (started) {
		applyShortcuts(settings);
		return;
	}

	started = true;
	app.on("will-quit", () => stopShortcuts());
	applyShortcuts(settings);
}

export function stopShortcuts(): void {
	unregisterRegistered();
}

export function applyShortcuts(settings: Settings): void {
	if (!started) return;
	lastSettings = settings;

	unregisterRegistered();
	if (suspended) return;

	const seen = new Set<string>();
	const bindings = buildBindings(settings.shortcuts);

	for (const { accelerator, action, handler } of bindings) {
		const normalized = accelerator.trim();
		if (seen.has(normalized)) {
			logger.warn("Duplicate shortcut ignored", {
				accelerator: normalized,
				action,
			});
			continue;
		}
		seen.add(normalized);

		const ok = registerShortcut(normalized, handler);
		if (!ok) {
			logger.warn("Shortcut registration rejected", {
				accelerator: normalized,
				action,
			});
			continue;
		}

		registered.add(normalized);
	}

	logger.info("Shortcuts applied", {
		count: registered.size,
		registered: Array.from(registered),
	});
}

export function setShortcutsSuspended(value: boolean): void {
	if (suspended === value) return;
	suspended = value;
	if (suspended) {
		unregisterRegistered();
		return;
	}
	if (lastSettings) {
		applyShortcuts(lastSettings);
	}
}
