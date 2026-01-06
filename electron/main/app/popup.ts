import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, type Rectangle, screen } from "electron";
import { IpcEvents } from "../../shared/ipc";
import {
	addTrustedWebContentsId,
	removeTrustedWebContentsId,
} from "../ipc/secure";

let popupWindow: BrowserWindow | null = null;

const POPUP_WIDTH = 420;
const POPUP_DEFAULT_HEIGHT = 330;
const POPUP_MIN_HEIGHT = 240;
const POPUP_MAX_HEIGHT = 1200;
const POPUP_MARGIN = 8;
const POPUP_VIEW_RESET_IDLE_MS = 60_000;

let popupHeight = POPUP_DEFAULT_HEIGHT;
let lastAnchor: Rectangle | undefined;
let userMoved = false;
let userPosition: { x: number; y: number } | null = null;
let isProgrammaticMove = false;
let resetViewTimeout: ReturnType<typeof setTimeout> | null = null;
let ignoreBlurUntil = 0;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function applyPopupOverlay(win: BrowserWindow): void {
	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
	win.setAlwaysOnTop(true, "screen-saver", 1);
}

function movePopupToActiveSpace(win: BrowserWindow): void {
	(
		win as unknown as {
			moveToActiveSpace?: () => void;
		}
	).moveToActiveSpace?.();
}

function displayForPopup(anchor?: Rectangle) {
	if (anchor) {
		return screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
	}
	if (userMoved && userPosition) {
		return screen.getDisplayNearestPoint(userPosition);
	}
	return screen.getPrimaryDisplay();
}

function computePopupPosition(anchor?: Rectangle): { x: number; y: number } {
	const display = displayForPopup(anchor);

	const { x: wx, y: wy, width: ww, height: wh } = display.workArea;
	const minX = wx + POPUP_MARGIN;
	const maxX = wx + ww - POPUP_WIDTH - POPUP_MARGIN;
	const minY = wy + POPUP_MARGIN;
	const maxY = wy + wh - popupHeight - POPUP_MARGIN;

	if (userMoved && userPosition) {
		return {
			x: clamp(userPosition.x, minX, maxX),
			y: clamp(userPosition.y, minY, maxY),
		};
	}

	if (!anchor) {
		return { x: maxX, y: minY };
	}

	const desiredX = Math.round(anchor.x + anchor.width / 2 - POPUP_WIDTH / 2);
	const desiredY = Math.round(anchor.y + anchor.height + POPUP_MARGIN);

	return {
		x: clamp(desiredX, minX, maxX),
		y: clamp(desiredY, minY, maxY),
	};
}

function setPopupBounds(bounds: Rectangle): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	isProgrammaticMove = true;
	try {
		popupWindow.setBounds(bounds, false);
	} finally {
		isProgrammaticMove = false;
	}
}

function clearResetViewTimeout(): void {
	if (!resetViewTimeout) return;
	clearTimeout(resetViewTimeout);
	resetViewTimeout = null;
}

function scheduleResetViewToPersonal(): void {
	clearResetViewTimeout();
	resetViewTimeout = setTimeout(() => {
		resetViewTimeout = null;
		if (!popupWindow || popupWindow.isDestroyed()) return;
		if (popupWindow.isVisible()) return;
		popupWindow.webContents.send(IpcEvents.PopupResetToPersonal);
	}, POPUP_VIEW_RESET_IDLE_MS);
}

function showPopup(): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	ignoreBlurUntil = Date.now() + 350;
	applyPopupOverlay(popupWindow);
	movePopupToActiveSpace(popupWindow);
	popupWindow.showInactive();
	popupWindow.moveTop();
	setTimeout(() => {
		if (!popupWindow || popupWindow.isDestroyed()) return;
		applyPopupOverlay(popupWindow);
		movePopupToActiveSpace(popupWindow);
		popupWindow.moveTop();
	}, 0);
}

function positionPopupWindow(anchor?: Rectangle): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	const { x, y } = computePopupPosition(anchor);
	setPopupBounds({ x, y, width: POPUP_WIDTH, height: popupHeight });
}

let isPopupReady = false;
let pendingShow: { anchor?: Rectangle } | null = null;

export function createPopupWindow(anchor?: Rectangle): BrowserWindow {
	if (popupWindow && !popupWindow.isDestroyed()) {
		return popupWindow;
	}

	lastAnchor = anchor;
	userMoved = false;
	userPosition = null;
	isPopupReady = false;
	const { x, y } = computePopupPosition(anchor);

	popupWindow = new BrowserWindow({
		width: POPUP_WIDTH,
		height: popupHeight,
		x,
		y,
		show: false,
		acceptFirstMouse: true,
		type: "panel",
		frame: false,
		resizable: false,
		movable: true,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
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

	applyPopupOverlay(popupWindow);

	const webContentsId = popupWindow.webContents.id;
	addTrustedWebContentsId(webContentsId);

	popupWindow.on("move", () => {
		if (!popupWindow || popupWindow.isDestroyed()) return;
		if (isProgrammaticMove) return;
		const bounds = popupWindow.getBounds();
		userMoved = true;
		userPosition = { x: bounds.x, y: bounds.y };
	});

	popupWindow.on("blur", () => {
		setTimeout(() => {
			if (!popupWindow || popupWindow.isDestroyed()) return;
			if (Date.now() < ignoreBlurUntil) return;
			if (popupWindow.isFocused()) return;
			hidePopupWindow();
		}, 100);
	});

	popupWindow.on("closed", () => {
		removeTrustedWebContentsId(webContentsId);
		clearResetViewTimeout();
		popupWindow = null;
		userMoved = false;
		userPosition = null;
		isProgrammaticMove = false;
		isPopupReady = false;
	});

	popupWindow.once("ready-to-show", () => {
		isPopupReady = true;
		if (pendingShow) {
			const anchor = pendingShow.anchor;
			pendingShow = null;
			positionPopupWindow(anchor);
			if (popupWindow && !popupWindow.isDestroyed()) {
				clearResetViewTimeout();
				showPopup();
			}
		}
	});

	const url = process.env.ELECTRON_RENDERER_URL
		? `${process.env.ELECTRON_RENDERER_URL}#popup`
		: pathToFileURL(join(__dirname, "../renderer/index.html")).toString() +
			"#popup";

	popupWindow.loadURL(url);

	return popupWindow;
}

export function getPopupWindow(): BrowserWindow | null {
	return popupWindow;
}

export function initPopupWindow(): void {
	if (popupWindow && !popupWindow.isDestroyed()) return;
	createPopupWindow();
}

export function showPopupWindow(anchor?: Rectangle): void {
	lastAnchor = anchor;
	if (!popupWindow || popupWindow.isDestroyed()) {
		pendingShow = { anchor };
		createPopupWindow(anchor);
		return;
	}
	if (!isPopupReady) {
		pendingShow = { anchor };
		return;
	}
	positionPopupWindow(anchor);
	clearResetViewTimeout();
	showPopup();
}

export function hidePopupWindow(): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	popupWindow.hide();
	scheduleResetViewToPersonal();
}

export function togglePopupWindow(anchor?: Rectangle): void {
	lastAnchor = anchor;
	if (!popupWindow || popupWindow.isDestroyed()) {
		pendingShow = { anchor };
		createPopupWindow(anchor);
		return;
	}

	if (popupWindow.isVisible()) {
		hidePopupWindow();
		return;
	}

	if (!isPopupReady) {
		pendingShow = { anchor };
		return;
	}

	positionPopupWindow(anchor);
	clearResetViewTimeout();
	showPopup();
}

export function destroyPopupWindow(): void {
	if (!popupWindow || popupWindow.isDestroyed()) {
		popupWindow = null;
		return;
	}
	clearResetViewTimeout();
	popupWindow.destroy();
	popupWindow = null;
}

export function setPopupHeight(height: number): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	const anchor = lastAnchor;
	const display = displayForPopup(anchor);
	const maxByDisplay = Math.max(0, display.workArea.height - POPUP_MARGIN * 2);
	const safeMax = Math.min(POPUP_MAX_HEIGHT, maxByDisplay);
	const safeMin = Math.min(POPUP_MIN_HEIGHT, safeMax);
	popupHeight = clamp(Math.round(height), safeMin, safeMax);
	positionPopupWindow(anchor);
}
