import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, screen, shell } from "electron";
import { createLogger } from "../infra/log";
import { setTrustedWebContentsIds } from "../ipc/secure";

let mainWindow: BrowserWindow | null = null;
let preventReadyToShow = false;
let hasShownMainWindow = false;

type CloseReason = "cmd_w" | null;
let closeReason: CloseReason = null;
let closeReasonResetTimer: NodeJS.Timeout | null = null;

const logger = createLogger({ scope: "MainWindow" });

function markCloseReason(value: CloseReason): void {
	closeReason = value;
	if (closeReasonResetTimer) clearTimeout(closeReasonResetTimer);
	closeReasonResetTimer = setTimeout(() => {
		closeReason = null;
		closeReasonResetTimer = null;
	}, 250);
}

function isTrafficLightClose(win: BrowserWindow): boolean {
	if (process.platform !== "darwin") return false;
	const p = screen.getCursorScreenPoint();
	const b = win.getBounds();
	const x = p.x - b.x;
	const y = p.y - b.y;
	return x >= 0 && y >= 0 && x <= 90 && y <= 40;
}

export function setMacActivationMode(mode: "foreground" | "background"): void {
	if (process.platform !== "darwin") return;
	logger.debug("setMacActivationMode", { mode });

	if (mode === "foreground") {
		try {
			void app.dock.show().catch(() => {});
		} catch {}
		try {
			app.setActivationPolicy("regular");
		} catch {}
		app.show();
		app.focus({ steal: true });
		return;
	}

	try {
		app.dock.hide();
	} catch {}
	try {
		app.setActivationPolicy("accessory");
	} catch {}
}

export function ensureMacDockVisible(): void {
	if (process.platform !== "darwin") return;
	try {
		void app.dock.show().catch(() => {});
	} catch {}
	try {
		app.setActivationPolicy("regular");
	} catch {}
}

export function hideMainWindow(options?: { hideFromDock?: boolean }): void {
	const hideFromDock = options?.hideFromDock ?? false;
	const win = mainWindow;
	if (!win || win.isDestroyed()) return;
	logger.debug("hideMainWindow", { hideFromDock });
	win.hide();
	if (hideFromDock) {
		setMacActivationMode("background");
	}
}

function getAppOrigin(): string | null {
	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (!devUrl) return null;
	try {
		return new URL(devUrl).origin;
	} catch {
		return null;
	}
}

function isAppNavigationUrl(url: string): boolean {
	try {
		const u = new URL(url);
		const appOrigin = getAppOrigin();
		if (appOrigin) return u.origin === appOrigin;

		const appFileUrl = pathToFileURL(join(__dirname, "../renderer/index.html"));
		return u.protocol === "file:" && u.pathname === appFileUrl.pathname;
	} catch {
		return false;
	}
}

function openExternalUrl(url: string): void {
	try {
		const u = new URL(url);
		if (u.protocol !== "http:" && u.protocol !== "https:") return;
		void shell.openExternal(u.toString(), { activate: true });
	} catch {
		return;
	}
}

export function createWindow(options?: {
	startHidden?: boolean;
}): BrowserWindow {
	const startHidden = options?.startHidden ?? false;
	preventReadyToShow = startHidden;
	hasShownMainWindow = false;

	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		show: false,
		titleBarStyle: "hiddenInset",
		// trafficLightPosition: { x: 7, y: 13 },
		backgroundColor: "#0E0E0E",
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			webviewTag: false,
		},
	});

	setTrustedWebContentsIds([mainWindow.webContents.id]);

	mainWindow.on("show", () => {
		hasShownMainWindow = true;
	});

	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (process.platform !== "darwin") return;
		if (input.type !== "keyDown") return;
		if (!input.meta) return;
		if (input.alt || input.control) return;
		if (String(input.key).toLowerCase() !== "w") return;
		markCloseReason("cmd_w");
		event.preventDefault();
		hideMainWindow();
	});

	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (isAppNavigationUrl(url)) return;
		event.preventDefault();
		openExternalUrl(url);
	});

	mainWindow.webContents.on("will-redirect", (event, url) => {
		if (isAppNavigationUrl(url)) return;
		event.preventDefault();
		openExternalUrl(url);
	});

	mainWindow.webContents.on("did-attach-webview", (event) => {
		event.preventDefault();
	});

	const session = mainWindow.webContents.session;
	session.setPermissionCheckHandler(() => false);
	session.setPermissionRequestHandler((_webContents, _permission, callback) =>
		callback(false),
	);

	mainWindow.on("ready-to-show", () => {
		if (preventReadyToShow) {
			return;
		}
		mainWindow?.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		openExternalUrl(details.url);
		return { action: "deny" };
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}

	return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
	return mainWindow;
}

export function showMainWindow(): void {
	const win = mainWindow;
	if (!win || win.isDestroyed()) return;

	preventReadyToShow = false;
	setMacActivationMode("foreground");

	if (win.isMinimized()) {
		win.restore();
	}

	win.show();
	win.moveTop();
	win.focus();
}

export function destroyMainWindow(): void {
	mainWindow?.destroy();
	mainWindow = null;
}

export function setupWindowCloseHandler(isQuitting: () => boolean): void {
	mainWindow?.on("close", (event) => {
		if (!isQuitting()) {
			logger.debug("close intercepted", {
				hasShownMainWindow,
				closeReason,
				preventReadyToShow,
			});
			event.preventDefault();
			const win = mainWindow;
			if (!win || win.isDestroyed()) return;
			const hideFromDock =
				process.platform === "darwin" &&
				hasShownMainWindow &&
				closeReason === null &&
				isTrafficLightClose(win);
			hideMainWindow({ hideFromDock });
			closeReason = null;
			if (closeReasonResetTimer) {
				clearTimeout(closeReasonResetTimer);
				closeReasonResetTimer = null;
			}
		}
	});
}
