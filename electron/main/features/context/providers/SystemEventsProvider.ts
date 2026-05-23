import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, screen } from "electron";
import { createLogger } from "../../../infra/log";
import type {
	ForegroundApp,
	ForegroundSnapshot,
	ForegroundWindow,
	WindowBounds,
} from "../types";

const logger = createLogger({ scope: "SystemEventsProvider" });
const FOREGROUND_BINARY_NAME = "screencap-foreground";
const FOREGROUND_TIMEOUT_MS = 800;

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

function getBinaryPath(): string {
	if (process.env.NODE_ENV === "test") return FOREGROUND_BINARY_NAME;
	if (app.isPackaged) {
		return join(process.resourcesPath, "foreground", FOREGROUND_BINARY_NAME);
	}

	return join(process.cwd(), "build", "foreground", FOREGROUND_BINARY_NAME);
}

async function runForegroundBinary(): Promise<string | null> {
	const binary = getBinaryPath();
	if (binary !== FOREGROUND_BINARY_NAME && !existsSync(binary)) {
		throw new Error(`Foreground binary not found at ${binary}`);
	}

	return await new Promise((resolve, reject) => {
		execFile(
			binary,
			[],
			{
				timeout: FOREGROUND_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
			},
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(String(stdout).trim());
			},
		);
	});
}

export async function collectForegroundSnapshot(): Promise<ForegroundSnapshot | null> {
	let output: string | null;
	try {
		output = await runForegroundBinary();
	} catch (error) {
		lastAutomationError =
			error instanceof Error ? error.message : String(error);
		logger.debug("Failed to get foreground snapshot", {
			error: lastAutomationError,
		});
		return null;
	}

	const parsed = output ? parseOutput(output) : null;
	if (!parsed) {
		logger.debug("Failed to parse output", { output });
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
