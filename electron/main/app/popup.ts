import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, type Rectangle, screen } from "electron";
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

let popupHeight = POPUP_DEFAULT_HEIGHT;
let lastAnchor: Rectangle | undefined;
let userMoved = false;
let userPosition: { x: number; y: number } | null = null;
let isProgrammaticMove = false;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
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
		popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		popupWindow.setAlwaysOnTop(true, "pop-up-menu");
	}

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
			if (popupWindow.isFocused()) return;
			hidePopupWindow();
		}, 0);
	});

	popupWindow.on("closed", () => {
		removeTrustedWebContentsId(webContentsId);
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
				popupWindow.showInactive();
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
	popupWindow.showInactive();
}

export function hidePopupWindow(): void {
	if (!popupWindow || popupWindow.isDestroyed()) return;
	popupWindow.hide();
}

export function togglePopupWindow(anchor?: Rectangle): void {
	lastAnchor = anchor;
	if (!popupWindow || popupWindow.isDestroyed()) {
		pendingShow = { anchor };
		createPopupWindow(anchor);
		return;
	}

	if (popupWindow.isVisible()) {
		popupWindow.hide();
		return;
	}

	if (!isPopupReady) {
		pendingShow = { anchor };
		return;
	}

	positionPopupWindow(anchor);
	popupWindow.showInactive();
}

export function destroyPopupWindow(): void {
	if (!popupWindow || popupWindow.isDestroyed()) {
		popupWindow = null;
		return;
	}
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
