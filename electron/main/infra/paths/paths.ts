import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

let userDataPath: string | null = null;

function getUserDataPath(): string {
	if (!userDataPath) {
		userDataPath = app.getPath("userData");
	}
	return userDataPath;
}

function ensureDir(dir: string): string {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function getDbPath(): string {
	return join(getUserDataPath(), "screencap.db");
}

export function getSettingsPath(): string {
	return join(getUserDataPath(), "settings.json");
}

export function getScreenshotsDir(): string {
	return ensureDir(join(getUserDataPath(), "screenshots"));
}

export function getThumbnailsDir(): string {
	return ensureDir(join(getScreenshotsDir(), "thumbnails"));
}

export function getOriginalsDir(): string {
	return ensureDir(join(getScreenshotsDir(), "originals"));
}

export function getFaviconsDir(): string {
	return ensureDir(join(getScreenshotsDir(), "favicons"));
}

export function getTempCapturesDir(): string {
	return ensureDir(join(getScreenshotsDir(), "tmp"));
}
