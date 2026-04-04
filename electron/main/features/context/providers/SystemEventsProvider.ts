import { screen } from "electron";
import { createLogger } from "../../../infra/log";
import { runPersistentJxa } from "../applescript";
import type {
	ForegroundApp,
	ForegroundSnapshot,
	ForegroundWindow,
	WindowBounds,
} from "../types";

const logger = createLogger({ scope: "SystemEventsProvider" });

const FOREGROUND_SNAPSHOT_SESSION_KEY = "foreground-snapshot";

const COMBINED_SCRIPT = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

function unwrapString(value) {
  if (!value || value.isNil()) return '';
  return ObjC.unwrap(value);
}

var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (!app || app.isNil()) {
  return null;
}

var pid = app.processIdentifier;
var appName = unwrapString(app.localizedName);
var bundleId = unwrapString(app.bundleIdentifier);
var windowTitle = '';
var x = 0;
var y = 0;
var width = 0;
var height = 0;

var options = (1 << 0) | (1 << 4);
var windowsRef = $.CGWindowListCopyWindowInfo(options, 0);
var windows = ObjC.castRefToObject(windowsRef);
var count = windows ? windows.count : 0;

for (var i = 0; i < count; i++) {
  var win = windows.objectAtIndex(i);
  var ownerPid = win.objectForKey('kCGWindowOwnerPID');
  if (!ownerPid || ownerPid.intValue !== pid) continue;

  var layer = win.objectForKey('kCGWindowLayer');
  if (layer && layer.intValue > 0) continue;

  var alpha = win.objectForKey('kCGWindowAlpha');
  if (alpha && alpha.doubleValue < 0.1) continue;

  var boundsDict = win.objectForKey('kCGWindowBounds');
  if (!boundsDict) continue;

  var candidateWidth = boundsDict.objectForKey('Width').doubleValue;
  var candidateHeight = boundsDict.objectForKey('Height').doubleValue;
  if (candidateWidth < 10 || candidateHeight < 10) continue;

  windowTitle = unwrapString(win.objectForKey('kCGWindowName'));
  x = Math.round(boundsDict.objectForKey('X').doubleValue);
  y = Math.round(boundsDict.objectForKey('Y').doubleValue);
  width = Math.round(candidateWidth);
  height = Math.round(candidateHeight);
  break;
}

return {
  appName: appName,
  bundleId: bundleId,
  pid: pid,
  windowTitle: windowTitle,
  x: x,
  y: y,
  width: width,
  height: height,
};
`;

interface ParsedOutput {
	app: ForegroundApp;
	window: Omit<ForegroundWindow, "displayId" | "isFullscreen">;
}

interface ParsedForegroundPayload {
	appName?: unknown;
	bundleId?: unknown;
	height?: unknown;
	pid?: unknown;
	width?: unknown;
	windowTitle?: unknown;
	x?: unknown;
	y?: unknown;
}

function parseInteger(value: unknown, fallback = 0): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.round(value);
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = parseInt(value, 10);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return fallback;
}

function parseOutput(output: string): ParsedOutput | null {
	let payload: ParsedForegroundPayload;
	try {
		payload = JSON.parse(output) as ParsedForegroundPayload;
	} catch {
		return null;
	}

	if (
		typeof payload.appName !== "string" ||
		typeof payload.bundleId !== "string"
	) {
		return null;
	}

	const pid = parseInteger(payload.pid, Number.NaN);
	if (Number.isNaN(pid)) return null;

	const x = parseInteger(payload.x);
	const y = parseInteger(payload.y);
	const width = parseInteger(payload.width);
	const height = parseInteger(payload.height);

	return {
		app: {
			name: payload.appName,
			bundleId: payload.bundleId,
			pid,
		},
		window: {
			title: typeof payload.windowTitle === "string" ? payload.windowTitle : "",
			bounds: { x, y, width, height },
		},
	};
}

function findDisplayForWindow(bounds: WindowBounds): {
	displayId: string;
	isFullscreen: boolean;
} {
	const displays = screen.getAllDisplays();

	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;

	let matchedDisplay = displays[0];
	for (const display of displays) {
		const db = display.bounds;
		if (
			centerX >= db.x &&
			centerX < db.x + db.width &&
			centerY >= db.y &&
			centerY < db.y + db.height
		) {
			matchedDisplay = display;
			break;
		}
	}

	const displayId = String(matchedDisplay.id);
	const db = matchedDisplay.bounds;
	const wa = matchedDisplay.workArea;

	const matchesBounds =
		Math.abs(bounds.x - db.x) <= 5 &&
		Math.abs(bounds.y - db.y) <= 30 &&
		Math.abs(bounds.width - db.width) <= 5 &&
		Math.abs(bounds.height - db.height) <= 30;

	const matchesWorkArea =
		Math.abs(bounds.x - wa.x) <= 5 &&
		Math.abs(bounds.y - wa.y) <= 5 &&
		Math.abs(bounds.width - wa.width) <= 5 &&
		Math.abs(bounds.height - wa.height) <= 5;

	const isFullscreen = matchesBounds || matchesWorkArea;

	return { displayId, isFullscreen };
}

type AutomationState = "not-attempted" | "granted" | "denied";

let automationState: AutomationState = "granted";
let lastAutomationError: string | null = null;

export async function collectForegroundSnapshot(): Promise<ForegroundSnapshot | null> {
	const result = await runPersistentJxa(
		FOREGROUND_SNAPSHOT_SESSION_KEY,
		COMBINED_SCRIPT,
	);

	if (!result.success) {
		lastAutomationError = result.error;
		if (!result.timedOut) {
			logger.debug("Failed to get foreground snapshot", {
				error: result.error,
			});
		}
		return null;
	}

	const parsed = parseOutput(result.output);
	if (!parsed) {
		logger.debug("Failed to parse output", { output: result.output });
		return null;
	}

	const { displayId, isFullscreen } = findDisplayForWindow(
		parsed.window.bounds,
	);

	const window: ForegroundWindow = {
		...parsed.window,
		displayId,
		isFullscreen,
	};

	automationState = "granted";
	lastAutomationError = null;

	return {
		app: parsed.app,
		window,
		capturedAt: Date.now(),
	};
}

export function getLastAutomationError(): string | null {
	return lastAutomationError;
}

export function getAutomationState(): AutomationState {
	return automationState;
}
