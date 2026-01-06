import { app } from "electron";
import { stopQueueProcessor } from "../features/queue";
import {
	stopHqRetentionService,
	stopRetentionService,
} from "../features/retention";
import { stopScheduler } from "../features/scheduler";
import { stopShortcuts } from "../features/shortcuts";
import { closeDatabase } from "../infra/db";
import { createLogger } from "../infra/log";
import { getCapturePopupWindow } from "./capturePopup";
import { destroyPopupWindow, getPopupWindow } from "./popup";
import {
	createWindow,
	getMainWindow,
	setupWindowCloseHandler,
	showMainWindow,
} from "./window";

const logger = createLogger({ scope: "Lifecycle" });

let isQuitting = false;

export function getIsQuitting(): boolean {
	return isQuitting;
}

export function setIsQuitting(value: boolean): void {
	isQuitting = value;
}

export function setupLifecycleHandlers(): void {
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit();
		}
	});

	app.on("activate", () => {
		// Don't interfere if capture popup is visible
		const capturePopup = getCapturePopupWindow();
		if (
			capturePopup &&
			!capturePopup.isDestroyed() &&
			capturePopup.isVisible()
		) {
			return;
		}

		// Don't interfere if tray popup is visible
		const trayPopup = getPopupWindow();
		if (trayPopup && !trayPopup.isDestroyed() && trayPopup.isVisible()) {
			return;
		}

		const win = getMainWindow();
		if (win === null) {
			const _newWin = createWindow();
			setupWindowCloseHandler(getIsQuitting);
		} else {
			showMainWindow();
		}
	});

	app.on("before-quit", () => {
		logger.info("App quitting...");
		isQuitting = true;
		destroyPopupWindow();
		stopShortcuts();
		stopScheduler();
		stopRetentionService();
		stopHqRetentionService();
		stopQueueProcessor();
		closeDatabase();
	});
}

export function performShutdown(): void {
	logger.info("Performing shutdown");
	isQuitting = true;
	stopScheduler();
	stopRetentionService();
	stopHqRetentionService();
	stopQueueProcessor();
	closeDatabase();
}
