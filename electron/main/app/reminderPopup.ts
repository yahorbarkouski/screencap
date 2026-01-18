import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, ipcMain, screen } from "electron";
import type { SmartReminderCapturePreviewPayload } from "../../shared/ipc";
import { createLogger } from "../infra/log";
import {
	addTrustedWebContentsId,
	removeTrustedWebContentsId,
} from "../ipc/secure";

const logger = createLogger({ scope: "ReminderPopup" });

let reminderPopupWindow: BrowserWindow | null = null;
let resultResolver: ((result: ReminderPopupResult | null) => void) | null =
	null;

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 520;

const POPUP_IPC_CHANNEL = "smart-reminder:popup-result";

export interface ReminderPopupInitData
	extends SmartReminderCapturePreviewPayload {
	thumbnailPath: string | null;
	originalPath: string | null;
}

export interface ReminderPopupResult {
	description: string;
	thumbnailPath: string | null;
	originalPath: string | null;
	appBundleId: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	contentKind: string | null;
	contextJson: string | null;
}

function setupPopupIpcHandler(): void {
	if (ipcMain.listenerCount(POPUP_IPC_CHANNEL) > 0) return;

	ipcMain.on(
		POPUP_IPC_CHANNEL,
		(_event, result: ReminderPopupResult | null) => {
			if (resultResolver) {
				resultResolver(result);
				resultResolver = null;
			}
			hideReminderPopup();
		},
	);
}

function computePopupPosition(): { x: number; y: number } {
	const display = screen.getPrimaryDisplay();
	const { x: wx, y: wy, width: ww, height: wh } = display.workArea;

	const x = Math.round(wx + (ww - POPUP_WIDTH) / 2);
	const y = Math.round(wy + (wh - POPUP_HEIGHT) / 2);

	return { x, y };
}

export function createReminderPopupWindow(): BrowserWindow {
	if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
		return reminderPopupWindow;
	}

	setupPopupIpcHandler();

	const { x, y } = computePopupPosition();

	reminderPopupWindow = new BrowserWindow({
		width: POPUP_WIDTH,
		height: POPUP_HEIGHT,
		x,
		y,
		show: false,
		acceptFirstMouse: true,
		frame: false,
		resizable: false,
		movable: true,
		minimizable: false,
		maximizable: false,
		closable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		transparent: true,
		hasShadow: true,
		vibrancy: "under-window",
		visualEffectState: "active",
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	if (process.platform === "darwin") {
		reminderPopupWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
		});
		reminderPopupWindow.setAlwaysOnTop(true, "pop-up-menu", 1);
	}

	const webContentsId = reminderPopupWindow.webContents.id;
	addTrustedWebContentsId(webContentsId);

	reminderPopupWindow.on("closed", () => {
		removeTrustedWebContentsId(webContentsId);
		reminderPopupWindow = null;
		if (resultResolver) {
			resultResolver(null);
			resultResolver = null;
		}
	});

	const url = process.env.ELECTRON_RENDERER_URL
		? `${process.env.ELECTRON_RENDERER_URL}#popup-reminder`
		: pathToFileURL(join(__dirname, "../renderer/index.html")).toString() +
			"#popup-reminder";

	reminderPopupWindow.loadURL(url);

	return reminderPopupWindow;
}

export function showReminderPopup(
	initData: ReminderPopupInitData,
): Promise<ReminderPopupResult | null> {
	return new Promise((resolve) => {
		resultResolver = resolve;

		if (!reminderPopupWindow || reminderPopupWindow.isDestroyed()) {
			createReminderPopupWindow();
		}

		const waitForReady = async () => {
			const win = reminderPopupWindow;
			if (!win || win.isDestroyed()) {
				resolve(null);
				return;
			}

			if (win.webContents.isLoadingMainFrame()) {
				await new Promise<void>((res) => {
					const done = () => res();
					win.webContents.once("did-finish-load", done);
					win.webContents.once("did-fail-load", done);
				});
			}

			if (win.isDestroyed()) {
				resolve(null);
				return;
			}

			win.webContents.send("smart-reminder:popup-init", initData);
			win.show();
			win.focus();

			logger.info("Reminder popup shown");
		};

		void waitForReady();
	});
}

export function hideReminderPopup(): void {
	if (!reminderPopupWindow || reminderPopupWindow.isDestroyed()) return;
	reminderPopupWindow.hide();
}

export function destroyReminderPopup(): void {
	if (!reminderPopupWindow || reminderPopupWindow.isDestroyed()) {
		reminderPopupWindow = null;
		return;
	}
	reminderPopupWindow.destroy();
	reminderPopupWindow = null;
}

export function getReminderPopupWindow(): BrowserWindow | null {
	return reminderPopupWindow;
}
