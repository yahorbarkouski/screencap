import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, type Rectangle, screen } from "electron";
import { IpcEvents, type ProjectProgressPreview } from "../../shared/ipc";
import {
	addTrustedWebContentsId,
	removeTrustedWebContentsId,
} from "../ipc/secure";

let capturePopupWindow: BrowserWindow | null = null;

const CAPTURE_POPUP_WIDTH = 560;
const CAPTURE_POPUP_DEFAULT_HEIGHT = 720;
const CAPTURE_POPUP_MIN_HEIGHT = 360;
const CAPTURE_POPUP_MAX_HEIGHT = 1400;
const CAPTURE_POPUP_MARGIN = 8;

let capturePopupHeight = CAPTURE_POPUP_DEFAULT_HEIGHT;
let lastAnchor: Rectangle | undefined;
let userMoved = false;
let userPosition: { x: number; y: number } | null = null;
let isProgrammaticMove = false;

let isCapturePopupReady = false;
let pendingShow: { anchor?: Rectangle } | null = null;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function displayForCapturePopup(anchor?: Rectangle) {
	if (anchor) {
		return screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
	}
	if (userMoved && userPosition) {
		return screen.getDisplayNearestPoint(userPosition);
	}
	return screen.getPrimaryDisplay();
}

function computeCapturePopupPosition(anchor?: Rectangle): {
	x: number;
	y: number;
} {
	const display = displayForCapturePopup(anchor);

	const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
	const minX = wx + CAPTURE_POPUP_MARGIN;
	const maxX = wx + ww - CAPTURE_POPUP_WIDTH - CAPTURE_POPUP_MARGIN;
	const minY = wy + CAPTURE_POPUP_MARGIN;
	const maxY = wy + wh - capturePopupHeight - CAPTURE_POPUP_MARGIN;

	if (userMoved && userPosition) {
		return {
			x: clamp(userPosition.x, minX, maxX),
			y: clamp(userPosition.y, minY, maxY),
		};
	}

	if (!anchor) {
		return { x: maxX, y: minY };
	}

	const desiredX = Math.round(
		anchor.x + anchor.width / 2 - CAPTURE_POPUP_WIDTH / 2,
	);
	const desiredY = Math.round(anchor.y + anchor.height + CAPTURE_POPUP_MARGIN);

	return {
		x: clamp(desiredX, minX, maxX),
		y: clamp(desiredY, minY, maxY),
	};
}

function setBounds(bounds: Rectangle): void {
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) return;
	isProgrammaticMove = true;
	try {
		capturePopupWindow.setBounds(bounds, false);
	} finally {
		isProgrammaticMove = false;
	}
}

function positionCapturePopupWindow(anchor?: Rectangle): void {
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) return;
	const { x, y } = computeCapturePopupPosition(anchor);
	setBounds({ x, y, width: CAPTURE_POPUP_WIDTH, height: capturePopupHeight });
}

export function createCapturePopupWindow(anchor?: Rectangle): BrowserWindow {
	if (capturePopupWindow && !capturePopupWindow.isDestroyed()) {
		return capturePopupWindow;
	}

	lastAnchor = anchor;
	userMoved = false;
	userPosition = null;
	isCapturePopupReady = false;

	const { x, y } = computeCapturePopupPosition(anchor);

	capturePopupWindow = new BrowserWindow({
		width: CAPTURE_POPUP_WIDTH,
		height: capturePopupHeight,
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
		capturePopupWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
		});
		capturePopupWindow.setAlwaysOnTop(true, "pop-up-menu");
	}

	const webContentsId = capturePopupWindow.webContents.id;
	addTrustedWebContentsId(webContentsId);

	capturePopupWindow.on("move", () => {
		if (!capturePopupWindow || capturePopupWindow.isDestroyed()) return;
		if (isProgrammaticMove) return;
		const bounds = capturePopupWindow.getBounds();
		userMoved = true;
		userPosition = { x: bounds.x, y: bounds.y };
	});

	capturePopupWindow.on("closed", () => {
		removeTrustedWebContentsId(webContentsId);
		capturePopupWindow = null;
		userMoved = false;
		userPosition = null;
		isProgrammaticMove = false;
		isCapturePopupReady = false;
	});

	capturePopupWindow.once("ready-to-show", () => {
		isCapturePopupReady = true;
		if (pendingShow) {
			const anchor = pendingShow.anchor;
			pendingShow = null;
			positionCapturePopupWindow(anchor);
			if (capturePopupWindow && !capturePopupWindow.isDestroyed()) {
				capturePopupWindow.show();
				capturePopupWindow.focus();
			}
		}
	});

	const url = process.env.ELECTRON_RENDERER_URL
		? `${process.env.ELECTRON_RENDERER_URL}#popup-capture`
		: pathToFileURL(join(__dirname, "../renderer/index.html")).toString() +
			"#popup-capture";

	capturePopupWindow.loadURL(url);

	return capturePopupWindow;
}

export function getCapturePopupWindow(): BrowserWindow | null {
	return capturePopupWindow;
}

export function showCapturePopupWindow(anchor?: Rectangle): void {
	lastAnchor = anchor;
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) {
		pendingShow = { anchor };
		createCapturePopupWindow(anchor);
		return;
	}
	if (!isCapturePopupReady) {
		pendingShow = { anchor };
		return;
	}
	positionCapturePopupWindow(anchor);
	capturePopupWindow.show();
	capturePopupWindow.focus();
}

export function hideCapturePopupWindow(): void {
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) return;
	capturePopupWindow.hide();
}

export function destroyCapturePopupWindow(): void {
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) {
		capturePopupWindow = null;
		return;
	}
	capturePopupWindow.destroy();
	capturePopupWindow = null;
}

export function setCapturePopupHeight(height: number): void {
	if (!capturePopupWindow || capturePopupWindow.isDestroyed()) return;
	const anchor = lastAnchor;
	const display = displayForCapturePopup(anchor);
	const maxByDisplay = Math.max(
		0,
		display.workArea.height - CAPTURE_POPUP_MARGIN * 2,
	);
	const safeMax = Math.min(CAPTURE_POPUP_MAX_HEIGHT, maxByDisplay);
	const safeMin = Math.min(CAPTURE_POPUP_MIN_HEIGHT, safeMax);
	capturePopupHeight = clamp(Math.round(height), safeMin, safeMax);
	positionCapturePopupWindow(anchor);
}

async function waitForPopupReady(): Promise<BrowserWindow | null> {
	const win = getCapturePopupWindow();
	if (!win || win.isDestroyed()) return null;

	if (win.webContents.isLoadingMainFrame()) {
		await new Promise<void>((resolve) => {
			const done = () => resolve();
			win.webContents.once("did-finish-load", done);
			win.webContents.once("did-fail-load", done);
		});
	}

	return win.isDestroyed() ? null : win;
}

export async function sendPreviewToPopup(
	preview: ProjectProgressPreview,
): Promise<void> {
	const win = await waitForPopupReady();
	if (!win) return;
	win.webContents.send(
		IpcEvents.ShortcutCaptureProjectProgressPreview,
		preview,
	);
}

export function sendEventIdToPopup(eventId: string): void {
	const win = getCapturePopupWindow();
	if (!win || win.isDestroyed()) return;
	win.webContents.send(IpcEvents.ShortcutCaptureProjectProgress, eventId);
}

export async function openProjectProgressCapture(input: {
	eventId: string;
	anchor?: Rectangle;
}): Promise<void> {
	const eventId = input.eventId.trim();
	if (!eventId) return;

	showCapturePopupWindow(input.anchor);
	const win = await waitForPopupReady();
	if (!win) return;
	win.webContents.send(IpcEvents.ShortcutCaptureProjectProgress, eventId);
}
