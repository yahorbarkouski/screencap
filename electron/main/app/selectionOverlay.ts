import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { WebContents } from "electron";
import { BrowserWindow, ipcMain, screen } from "electron";
import { isSelfApp } from "../../shared/appIdentity";
import { runAppleScript, runJxa } from "../features/context/applescript";
import { createLogger } from "../infra/log";
import {
	addTrustedWebContentsId,
	removeTrustedWebContentsId,
} from "../ipc/secure";

const logger = createLogger({ scope: "SelectionOverlay" });

let overlayWindow: BrowserWindow | null = null;
let selectionResolver: ((bounds: SelectionBounds | null) => void) | null = null;
let pendingInitPayload: {
	displays: Array<{
		id: string;
		bounds: { x: number; y: number; width: number; height: number };
		scaleFactor: number;
	}>;
	offset: { x: number; y: number };
} | null = null;

export interface SelectionBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	displayId: string;
	scaleFactor: number;
	appBundleId?: string | null;
	appName?: string | null;
	windowTitle?: string | null;
}

const OVERLAY_IPC_CHANNEL = "selection-overlay:result";
const OVERLAY_READY_CHANNEL = "selection-overlay:ready";
const OVERLAY_HOVER_CHANNEL = "selection-overlay:hover";
const OVERLAY_HOVER_RESULT_CHANNEL = "selection-overlay:hover-result";

let hoverInFlight = false;
let pendingHoverPoint: { x: number; y: number } | null = null;

interface CachedWindow {
	x: number;
	y: number;
	width: number;
	height: number;
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
}

let cachedWindows: CachedWindow[] = [];
let cacheRefreshInFlight = false;
let lastCacheRefresh = 0;
const CACHE_REFRESH_INTERVAL = 500;

function normalizeSelectionBounds(bounds: SelectionBounds): SelectionBounds {
	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;
	const display = screen.getDisplayNearestPoint({
		x: Number.isFinite(centerX) ? centerX : bounds.x,
		y: Number.isFinite(centerY) ? centerY : bounds.y,
	});

	return {
		...bounds,
		displayId: String(display.id),
		scaleFactor: display.scaleFactor,
	};
}

function setupOverlayIpcHandler(): void {
	if (ipcMain.listenerCount(OVERLAY_IPC_CHANNEL) === 0) {
		ipcMain.on(
			OVERLAY_IPC_CHANNEL,
			(_event, bounds: SelectionBounds | null) => {
				if (selectionResolver) {
					selectionResolver(bounds ? normalizeSelectionBounds(bounds) : null);
					selectionResolver = null;
				}
				hideOverlay();
			},
		);
	}

	if (ipcMain.listenerCount(OVERLAY_READY_CHANNEL) === 0) {
		ipcMain.on(OVERLAY_READY_CHANNEL, () => {
			if (!overlayWindow || overlayWindow.isDestroyed()) return;
			if (!pendingInitPayload) return;
			overlayWindow.webContents.send(
				"selection-overlay:init",
				pendingInitPayload,
			);
		});
	}

	if (ipcMain.listenerCount(OVERLAY_HOVER_CHANNEL) === 0) {
		ipcMain.on(
			OVERLAY_HOVER_CHANNEL,
			(event, point: { x: number; y: number }) => {
				pendingHoverPoint = point;
				if (hoverInFlight) return;
				processHoverQueue(event.sender);
			},
		);
	}
}

export function createOverlayWindow(): BrowserWindow {
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		return overlayWindow;
	}

	setupOverlayIpcHandler();

	const primaryDisplay = screen.getPrimaryDisplay();
	const { x, y, width, height } = primaryDisplay.bounds;

	overlayWindow = new BrowserWindow({
		x,
		y,
		width,
		height,
		show: false,
		frame: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		closable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		transparent: true,
		hasShadow: false,
		enableLargerThanScreen: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	if (process.platform === "darwin") {
		overlayWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
		});
		overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
	}

	const webContentsId = overlayWindow.webContents.id;
	addTrustedWebContentsId(webContentsId);

	overlayWindow.on("closed", () => {
		removeTrustedWebContentsId(webContentsId);
		overlayWindow = null;
		pendingInitPayload = null;
		if (selectionResolver) {
			selectionResolver(null);
			selectionResolver = null;
		}
	});

	const url = process.env.ELECTRON_RENDERER_URL
		? `${process.env.ELECTRON_RENDERER_URL}#overlay-select`
		: pathToFileURL(join(__dirname, "../renderer/index.html")).toString() +
			"#overlay-select";

	overlayWindow.loadURL(url);

	return overlayWindow;
}

async function ensureOverlayReady(): Promise<void> {
	const win = overlayWindow;
	if (!win || win.isDestroyed()) return;
	if (!win.webContents.isLoadingMainFrame()) return;
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			resolve();
		};
		win.webContents.once("did-finish-load", finish);
		win.webContents.once("did-fail-load", finish);
		win.once("closed", finish);
	});
}

async function refreshWindowCache(): Promise<void> {
	if (cacheRefreshInFlight) return;
	cacheRefreshInFlight = true;

	try {
		const script = `
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');

var opts = (1 << 0) | (1 << 4);
var listRef = $.CGWindowListCopyWindowInfo(opts, 0);
var nsArray = ObjC.castRefToObject(listRef);
var count = nsArray.count;

var results = [];

for (var i = 0; i < count; i++) {
    var win = nsArray.objectAtIndex(i);
    
    var layer = win.objectForKey('kCGWindowLayer');
    if (layer && layer.intValue > 0) continue;
    
    var alpha = win.objectForKey('kCGWindowAlpha');
    if (alpha && alpha.doubleValue < 0.1) continue;
    
    var boundsDict = win.objectForKey('kCGWindowBounds');
    if (!boundsDict) continue;
    
    var winX = boundsDict.objectForKey('X').doubleValue;
    var winY = boundsDict.objectForKey('Y').doubleValue;
    var winW = boundsDict.objectForKey('Width').doubleValue;
    var winH = boundsDict.objectForKey('Height').doubleValue;
    
    if (winW < 10 || winH < 10) continue;
    
    var ownerName = win.objectForKey('kCGWindowOwnerName');
    var windowName = win.objectForKey('kCGWindowName');
    var ownerPID = win.objectForKey('kCGWindowOwnerPID');
    
    var appName = ownerName ? ObjC.unwrap(ownerName) : '';
    var winTitle = windowName ? ObjC.unwrap(windowName) : '';
    var pid = ownerPID ? ownerPID.intValue : 0;
    
    var bundleId = '';
    if (pid > 0) {
        var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
        if (app && !app.isNil()) {
            var bid = app.bundleIdentifier;
            if (bid && !bid.isNil()) {
                bundleId = ObjC.unwrap(bid);
            }
        }
    }
    
    results.push([bundleId, appName, winTitle, Math.round(winX), Math.round(winY), Math.round(winW), Math.round(winH)].join('|||'));
}

results.join('\\n');
`;

		const jxaResult = await runJxa(script, 2000);
		if (jxaResult.success && jxaResult.output.trim()) {
			const lines = jxaResult.output.trim().split("\n");
			const windows: CachedWindow[] = [];

			for (const line of lines) {
				const parts = line.split("|||");
				if (parts.length < 7) continue;

				const [bundleId, appName, windowTitle, x, y, width, height] = parts;
				const winX = parseInt(x, 10);
				const winY = parseInt(y, 10);
				const winW = parseInt(width, 10);
				const winH = parseInt(height, 10);

				if (
					Number.isNaN(winX) ||
					Number.isNaN(winY) ||
					Number.isNaN(winW) ||
					Number.isNaN(winH) ||
					winW <= 0 ||
					winH <= 0
				)
					continue;

				if (isSelfApp({ bundleId, name: appName, windowTitle })) continue;

				windows.push({
					x: winX,
					y: winY,
					width: winW,
					height: winH,
					appBundleId: bundleId || null,
					appName: appName || null,
					windowTitle: windowTitle || null,
				});
			}

			cachedWindows = windows;
			lastCacheRefresh = Date.now();
			return;
		}

		const fallbackScript = `
tell application "System Events"
  set allProcs to application processes whose visible is true
  set results to {}
  repeat with p in allProcs
    try
      set wins to windows of p
      repeat with w in wins
        set winPos to position of w
        set winSize to size of w
        set winX to item 1 of winPos
        set winY to item 2 of winPos
        set winW to item 1 of winSize
        set winH to item 2 of winSize
        set bid to bundle identifier of p
        set appName to name of p
        set winTitle to name of w
        set end of results to bid & "|||" & appName & "|||" & winTitle & "|||" & winX & "|||" & winY & "|||" & winW & "|||" & winH
      end repeat
    end try
  end repeat
  set text item delimiters to linefeed
  return results as text
end tell
`;
		const fallbackResult = await runAppleScript(fallbackScript, 2000);
		if (fallbackResult.success && fallbackResult.output.trim()) {
			const lines = fallbackResult.output.trim().split("\n");
			const windows: CachedWindow[] = [];

			for (const line of lines) {
				const parts = line.split("|||");
				if (parts.length < 7) continue;

				const [bundleId, appName, windowTitle, x, y, width, height] = parts;
				const winX = parseInt(x, 10);
				const winY = parseInt(y, 10);
				const winW = parseInt(width, 10);
				const winH = parseInt(height, 10);

				if (
					Number.isNaN(winX) ||
					Number.isNaN(winY) ||
					Number.isNaN(winW) ||
					Number.isNaN(winH) ||
					winW <= 0 ||
					winH <= 0
				)
					continue;

				if (isSelfApp({ bundleId, name: appName, windowTitle })) continue;

				windows.push({
					x: winX,
					y: winY,
					width: winW,
					height: winH,
					appBundleId: bundleId || null,
					appName: appName || null,
					windowTitle: windowTitle || null,
				});
			}

			cachedWindows = windows;
			lastCacheRefresh = Date.now();
		}
	} catch (error) {
		logger.debug("Failed to refresh window cache", { error });
	} finally {
		cacheRefreshInFlight = false;
	}
}

function findWindowAtPoint(point: {
	x: number;
	y: number;
}): SelectionBounds | null {
	const now = Date.now();
	if (now - lastCacheRefresh > CACHE_REFRESH_INTERVAL) {
		void refreshWindowCache();
	}

	for (const win of cachedWindows) {
		if (
			point.x >= win.x &&
			point.x <= win.x + win.width &&
			point.y >= win.y &&
			point.y <= win.y + win.height
		) {
			const display = screen.getDisplayNearestPoint({
				x: point.x,
				y: point.y,
			});

			return {
				x: win.x,
				y: win.y,
				width: win.width,
				height: win.height,
				displayId: String(display.id),
				scaleFactor: display.scaleFactor,
				appBundleId: win.appBundleId,
				appName: win.appName,
				windowTitle: win.windowTitle,
			};
		}
	}

	return null;
}

function processHoverQueue(sender: WebContents): void {
	if (hoverInFlight) return;
	hoverInFlight = true;

	while (pendingHoverPoint) {
		const point = pendingHoverPoint;
		pendingHoverPoint = null;
		if (!point) break;
		const result = findWindowAtPoint(point);
		if (sender.isDestroyed()) break;
		sender.send(OVERLAY_HOVER_RESULT_CHANNEL, result);
	}

	hoverInFlight = false;
}

export async function showOverlay(): Promise<SelectionBounds | null> {
	cachedWindows = [];
	lastCacheRefresh = 0;
	void refreshWindowCache();

	if (!overlayWindow || overlayWindow.isDestroyed()) {
		createOverlayWindow();
	}

	await ensureOverlayReady();

	return new Promise((resolve) => {
		selectionResolver = resolve;

		const displays = screen.getAllDisplays();
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const display of displays) {
			const { x, y, width, height } = display.bounds;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x + width > maxX) maxX = x + width;
			if (y + height > maxY) maxY = y + height;
		}

		const totalWidth = maxX - minX;
		const totalHeight = maxY - minY;

		overlayWindow?.setBounds({
			x: minX,
			y: minY,
			width: totalWidth,
			height: totalHeight,
		});

		const displayInfo = displays.map((d) => ({
			id: String(d.id),
			bounds: d.bounds,
			scaleFactor: d.scaleFactor,
		}));

		pendingInitPayload = {
			displays: displayInfo,
			offset: { x: minX, y: minY },
		};

		overlayWindow?.webContents.send(
			"selection-overlay:init",
			pendingInitPayload,
		);

		overlayWindow?.show();
		overlayWindow?.focus();

		logger.info("Selection overlay shown", {
			bounds: { x: minX, y: minY, width: totalWidth, height: totalHeight },
		});
	});
}

export function hideOverlay(): void {
	if (!overlayWindow || overlayWindow.isDestroyed()) return;
	overlayWindow.hide();
}

export function destroyOverlay(): void {
	if (!overlayWindow || overlayWindow.isDestroyed()) {
		overlayWindow = null;
		return;
	}
	overlayWindow.destroy();
	overlayWindow = null;
}

export function getOverlayWindow(): BrowserWindow | null {
	return overlayWindow;
}
