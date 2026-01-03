import { app } from "electron";
import { stopQueueProcessor } from "../features/queue";
import { stopRetentionService } from "../features/retention";
import { stopScheduler } from "../features/scheduler";
import { stopShortcuts } from "../features/shortcuts";
import { closeDatabase } from "../infra/db";
import { createLogger } from "../infra/log";
import { getCapturePopupWindow } from "./capturePopup";
import { destroyPopupWindow } from "./popup";
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
		const capturePopup = getCapturePopupWindow();
		if (
			capturePopup &&
			!capturePopup.isDestroyed() &&
			capturePopup.isVisible()
		) {
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
		stopQueueProcessor();
		closeDatabase();
	});
}

export function performShutdown(): void {
	logger.info("Performing shutdown");
	isQuitting = true;
	stopScheduler();
	stopRetentionService();
	stopQueueProcessor();
	closeDatabase();
}
