import { BrowserWindow } from "electron";
import { IpcChannels } from "../../../shared/ipc";
import type {
	CaptureTriggerOptions,
	CaptureTriggerResult,
} from "../../../shared/types";
import {
	captureAllDisplays,
	captureForClassification,
} from "../../features/capture";
import { triggerManualCaptureWithPrimaryDisplay } from "../../features/scheduler";
import { createLogger } from "../../infra/log";
import { secureHandle, secureHandleWithEvent } from "../secure";
import { ipcCaptureTriggerArgs, ipcNoArgs } from "../validation";

const logger = createLogger({ scope: "CaptureIPC" });

function isPopupWindow(win: BrowserWindow): boolean {
	const url = win.webContents.getURL();
	return url.includes("#popup");
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function registerCaptureHandlers(): void {
	secureHandle(IpcChannels.Capture.AllDisplays, ipcNoArgs, async () => {
		return captureAllDisplays();
	});

	secureHandle(IpcChannels.Capture.Primary, ipcNoArgs, async () => {
		const buffer = await captureForClassification();
		return buffer ? buffer.toString("base64") : null;
	});

	secureHandleWithEvent(
		IpcChannels.Capture.Trigger,
		ipcCaptureTriggerArgs,
		async (
			event,
			options?: CaptureTriggerOptions,
		): Promise<CaptureTriggerResult> => {
			const intent = options?.intent ?? "default";
			const includeSenderWindow = options?.includeSenderWindow ?? false;

			logger.info("Manual capture triggered via IPC", { intent });

			const senderWindow = BrowserWindow.fromWebContents(event.sender);
			const senderIsPopup = senderWindow ? isPopupWindow(senderWindow) : false;
			const shouldRestoreSender =
				!!senderWindow && (!senderIsPopup || intent === "project_progress");
			const shouldRestoreFocused =
				shouldRestoreSender && senderWindow.isFocused();

			if (
				!includeSenderWindow &&
				senderWindow &&
				!senderWindow.isDestroyed() &&
				senderWindow.isVisible()
			) {
				senderWindow.hide();
				await sleep(160);
			}

			try {
				return await triggerManualCaptureWithPrimaryDisplay({ intent });
			} finally {
				if (
					!includeSenderWindow &&
					senderWindow &&
					shouldRestoreSender &&
					!senderWindow.isDestroyed()
				) {
					if (shouldRestoreFocused) {
						senderWindow.show();
						senderWindow.focus();
					} else {
						senderWindow.showInactive();
					}
				}
			}
		},
	);
}
