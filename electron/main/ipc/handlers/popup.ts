import { BrowserWindow, screen } from "electron";
import { IpcChannels } from "../../../shared/ipc";
import {
	getCapturePopupWindow,
	sendEventIdToPopup,
	sendPreviewToPopup,
	setCapturePopupHeight,
	showCapturePopupWindow,
} from "../../app/capturePopup";
import { getPopupWindow, setPopupHeight } from "../../app/popup";
import { captureInstant, processInstantCapture } from "../../features/capture";
import { collectActivityContext } from "../../features/context";
import { processCaptureGroup } from "../../features/events";
import { checkScreenCapturePermission } from "../../features/permissions";
import { updateEvent } from "../../infra/db/repositories/EventRepository";
import { createLogger } from "../../infra/log";
import { broadcastEventUpdated } from "../../infra/windows";
import { secureHandleWithEvent } from "../secure";
import { ipcNoArgs, ipcSetPopupHeightArgs } from "../validation";

const logger = createLogger({ scope: "PopupHandlers" });

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function registerPopupHandlers(): void {
	secureHandleWithEvent(
		IpcChannels.Popup.SetHeight,
		ipcSetPopupHeightArgs,
		(event, height) => {
			const senderWindow = BrowserWindow.fromWebContents(event.sender);
			if (!senderWindow || senderWindow.isDestroyed()) return;
			const trayPopup = getPopupWindow();
			if (
				trayPopup &&
				!trayPopup.isDestroyed() &&
				trayPopup.id === senderWindow.id
			) {
				setPopupHeight(height);
				return;
			}
			const capturePopup = getCapturePopupWindow();
			if (
				capturePopup &&
				!capturePopup.isDestroyed() &&
				capturePopup.id === senderWindow.id
			) {
				setCapturePopupHeight(height);
			}
		},
	);

	secureHandleWithEvent(
		IpcChannels.Popup.StartProjectProgressCapture,
		ipcNoArgs,
		async (event) => {
			if (!checkScreenCapturePermission()) {
				logger.warn("No screen capture permission");
				return;
			}

			const senderWindow = BrowserWindow.fromWebContents(event.sender);
			const anchor = senderWindow?.getBounds() ?? {
				x: screen.getCursorScreenPoint().x,
				y: screen.getCursorScreenPoint().y,
				width: 1,
				height: 1,
			};

			if (
				senderWindow &&
				!senderWindow.isDestroyed() &&
				senderWindow.isVisible()
			) {
				senderWindow.hide();
				await sleep(160);
			}

			const primaryDisplayId = String(screen.getPrimaryDisplay().id);
			const instantCapture = await captureInstant(primaryDisplayId);

			if (!instantCapture) {
				logger.warn("No captures available");
				return;
			}

			showCapturePopupWindow(anchor);
			await sendPreviewToPopup({
				imageBase64: instantCapture.previewBase64,
				project: null,
			});

			const [captures, context] = await Promise.all([
				processInstantCapture(instantCapture, {
					highResDisplayId: primaryDisplayId,
				}),
				collectActivityContext(),
			]);

			const result = await processCaptureGroup({
				captures,
				intervalMs: 5 * 60 * 1000,
				primaryDisplayId,
				context,
				enqueueToLlmQueue: false,
				allowMerge: false,
			});

			if (result.eventId) {
				updateEvent(result.eventId, {
					projectProgress: 1,
					projectProgressEvidence: "manual",
				});
				broadcastEventUpdated(result.eventId);
				sendEventIdToPopup(result.eventId);
			}
		},
	);
}
