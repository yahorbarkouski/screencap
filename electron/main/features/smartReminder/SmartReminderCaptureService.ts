import { BrowserWindow } from "electron";
import { v4 as uuid } from "uuid";
import {
	type ReminderPopupInitData,
	showReminderPopup,
} from "../../app/reminderPopup";
import { destroyOverlay, showOverlay } from "../../app/selectionOverlay";
import { insertReminder } from "../../infra/db/repositories/ReminderRepository";
import { createLogger } from "../../infra/log";
import { broadcastRemindersChanged } from "../../infra/windows";
import { captureRegion } from "../capture";
import { collectActivityContext } from "../context";
import { recognizeTextFromWebpBase64 } from "../ocr";
import { parseReminderWithAI } from "./ReminderParseService";

const logger = createLogger({ scope: "SmartReminderCapture" });

function hideAllAppWindows(): BrowserWindow[] {
	const windows = BrowserWindow.getAllWindows();
	const visibleWindows: BrowserWindow[] = [];

	for (const win of windows) {
		if (!win.isDestroyed() && win.isVisible()) {
			visibleWindows.push(win);
			win.hide();
		}
	}

	return visibleWindows;
}

function showWindows(windows: BrowserWindow[]): void {
	for (const win of windows) {
		if (!win.isDestroyed()) {
			win.show();
		}
	}
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startSmartReminderCapture(): Promise<void> {
	logger.info("Starting smart reminder capture flow");

	try {
		const selectionBounds = await showOverlay();

		if (!selectionBounds) {
			logger.info("Selection cancelled by user");
			destroyOverlay();
			return;
		}

		logger.info("Selection received", { bounds: selectionBounds });

		destroyOverlay();
		await delay(100);

		const hiddenWindows = hideAllAppWindows();
		await delay(50);

		const captureResult = await captureRegion(selectionBounds);

		showWindows(hiddenWindows);

		if (!captureResult) {
			logger.warn("Region capture failed");
			return;
		}

		logger.info("Region captured successfully", { id: captureResult.id });

		const selectionContext = {
			appBundleId: selectionBounds.appBundleId ?? null,
			windowTitle: selectionBounds.windowTitle ?? null,
		};

		const activityContext: {
			appBundleId: string | null;
			windowTitle: string | null;
			urlHost: string | null;
			contentKind: string | null;
			contextJson: string | null;
		} = {
			appBundleId: selectionContext.appBundleId,
			windowTitle: selectionContext.windowTitle,
			urlHost: null,
			contentKind: null,
			contextJson: null,
		};

		try {
			const context = await collectActivityContext();
			if (context) {
				const contextBundleId = context.app.bundleId ?? null;
				const matchesSelection =
					!activityContext.appBundleId ||
					activityContext.appBundleId === contextBundleId;

				if (!activityContext.appBundleId) {
					activityContext.appBundleId = contextBundleId;
				}
				if (!activityContext.windowTitle) {
					activityContext.windowTitle = context.window.title ?? null;
				}
				if (matchesSelection) {
					activityContext.urlHost = context.url?.host ?? null;
					activityContext.contentKind = context.content?.kind ?? null;
					activityContext.contextJson = JSON.stringify(context);
				}
			}
		} catch (error) {
			logger.warn("Failed to collect activity context", { error });
		}

		const popupInitData: ReminderPopupInitData = {
			imageBase64: captureResult.previewBase64,
			thumbnailPath: captureResult.thumbnailPath,
			originalPath: captureResult.originalPath,
			...activityContext,
		};

		const popupResult = await showReminderPopup(popupInitData);

		if (!popupResult) {
			logger.info("Reminder creation cancelled by user");
			return;
		}

		const userText = popupResult.description.trim();
		if (!userText) {
			logger.info("Reminder creation skipped: empty input");
			return;
		}

		let ocrText: string | null = null;
		try {
			if (captureResult.previewBase64) {
				const ocr = await recognizeTextFromWebpBase64(
					captureResult.previewBase64,
				);
				ocrText = ocr.text?.trim() || null;
			}
		} catch (error) {
			logger.warn("OCR failed", { error: String(error) });
		}

		const parsed = await parseReminderWithAI(
			userText,
			ocrText,
			{
				appBundleId: popupResult.appBundleId,
				windowTitle: popupResult.windowTitle,
				urlHost: popupResult.urlHost,
				contentKind: popupResult.contentKind,
			},
			captureResult.previewBase64,
		);

		const title = parsed.title.slice(0, 200);
		const body = parsed.body;
		const remindAt = parsed.isReminder ? parsed.remindAt : null;

		const reminderId = uuid();

		const reminder = insertReminder({
			id: reminderId,
			title,
			body,
			sourceText: userText,
			remindAt,
			thumbnailPath: popupResult.thumbnailPath,
			originalPath: popupResult.originalPath,
			appBundleId: popupResult.appBundleId,
			windowTitle: popupResult.windowTitle,
			urlHost: popupResult.urlHost,
			contentKind: popupResult.contentKind,
			contextJson: popupResult.contextJson,
		});

		broadcastRemindersChanged();

		logger.info("Reminder created successfully", {
			id: reminder.id,
			hasRemindAt: !!reminder.remindAt,
		});
	} catch (error) {
		logger.error("Smart reminder capture failed", { error });
		destroyOverlay();
	}
}
