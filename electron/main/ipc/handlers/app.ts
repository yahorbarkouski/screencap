import { execSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { release } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	nativeImage,
	shell,
} from "electron";
import sharp from "sharp";
import { IpcChannels, IpcEvents } from "../../../shared/ipc";
import type { AppInfo } from "../../../shared/types";
import { setIsQuitting } from "../../app/lifecycle";
import { showMainWindow } from "../../app/window";
import { closeDatabase } from "../../infra/db";
import { createLogger } from "../../infra/log";
import { getScreenshotsDir } from "../../infra/paths";
import { broadcast } from "../../infra/windows/broadcast";
import { secureHandle } from "../secure";
import {
	ipcCopyImageArgs,
	ipcNoArgs,
	ipcOpenExternalArgs,
	ipcOpenNativeArgs,
	ipcOpenSettingsTabArgs,
	ipcPreviewEventArgs,
} from "../validation";

const logger = createLogger({ scope: "AppIPC" });

declare const __BUILD_DATE__: string | undefined;
declare const __GIT_SHA__: string | undefined;
declare const __RELEASE_CHANNEL__: string | undefined;

function isSubpath(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function toPngBuffer(path: string): Promise<Buffer> {
	const input = readFileSync(path);
	return await sharp(input).png().toBuffer();
}

function getAppInfo(): AppInfo {
	return {
		name: app.getName(),
		version: app.getVersion(),
		isPackaged: app.isPackaged,
		buildDate: typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : null,
		gitSha: typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : null,
		releaseChannel:
			typeof __RELEASE_CHANNEL__ !== "undefined" ? __RELEASE_CHANNEL__ : null,
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		osVersion: release(),
	};
}

export function registerAppHandlers(): void {
	secureHandle(IpcChannels.App.Quit, ipcNoArgs, () => {
		app.quit();
	});

	secureHandle(IpcChannels.App.GetInfo, ipcNoArgs, () => {
		return getAppInfo();
	});

	secureHandle(IpcChannels.App.PickDirectory, ipcNoArgs, async () => {
		const browserWindow = BrowserWindow.getFocusedWindow();
		const result = browserWindow
			? await dialog.showOpenDialog(browserWindow, {
					properties: ["openDirectory"],
				})
			: await dialog.showOpenDialog({
					properties: ["openDirectory"],
				});
		if (result.canceled) return null;
		return result.filePaths[0] ?? null;
	});

	secureHandle(
		IpcChannels.App.CopyImage,
		ipcCopyImageArgs,
		async (path: string) => {
			const screenshotsRoot = realpathSync(getScreenshotsDir());
			const absolutePath = isAbsolute(path) ? path : resolve(path);
			if (!existsSync(absolutePath)) return false;

			let realPath: string;
			try {
				realPath = realpathSync(absolutePath);
			} catch {
				return false;
			}

			if (!isSubpath(screenshotsRoot, realPath)) return false;

			const png = await toPngBuffer(realPath);
			const image = nativeImage.createFromBuffer(png);
			if (image.isEmpty()) return false;
			clipboard.writeImage(image);
			return true;
		},
	);

	secureHandle(
		IpcChannels.App.OpenExternal,
		ipcOpenExternalArgs,
		async (url: string) => {
			const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "spotify:"]);
			try {
				const parsed = new URL(url);
				if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return;
				await shell.openExternal(url, { activate: true });
			} catch {
				return;
			}
		},
	);

	secureHandle(IpcChannels.App.RevealInFinder, ipcNoArgs, async () => {
		await shell.openPath(app.getPath("userData"));
	});

	secureHandle(
		IpcChannels.App.OpenNative,
		ipcOpenNativeArgs,
		async (path: string) => {
			const screenshotsRoot = realpathSync(getScreenshotsDir());
			const absolutePath = isAbsolute(path) ? path : resolve(path);
			if (!existsSync(absolutePath)) return;

			let realPath: string;
			try {
				realPath = realpathSync(absolutePath);
			} catch {
				return;
			}

			if (!isSubpath(screenshotsRoot, realPath)) return;
			await shell.openPath(realPath);
		},
	);

	secureHandle(
		IpcChannels.App.PreviewEvent,
		ipcPreviewEventArgs,
		(event: unknown) => {
			showMainWindow();
			broadcast(IpcEvents.PreviewEvent, event);
		},
	);

	secureHandle(
		IpcChannels.App.OpenSettingsTab,
		ipcOpenSettingsTabArgs,
		(tab: "capture" | "ai" | "automation" | "data" | "social" | "system") => {
			showMainWindow();
			broadcast(IpcEvents.OpenSettingsTab, tab);
		},
	);

	secureHandle(IpcChannels.App.FactoryReset, ipcNoArgs, async () => {
		const userDataDir = app.getPath("userData");
		const appName = app.getName();
		logger.info("Factory reset initiated", { userDataDir, appName });

		closeDatabase();

		try {
			await rm(userDataDir, { recursive: true, force: true });
			logger.info("User data directory deleted");
		} catch (error) {
			logger.error("Failed to delete user data directory", { error });
		}

		if (process.platform === "darwin") {
			try {
				execSync(
					`security delete-generic-password -s "${appName} Safe Storage" 2>/dev/null || true`,
				);
				logger.info("Keychain entry deleted");
			} catch {
				logger.info("No keychain entry to delete or already removed");
			}
		}

		setIsQuitting(true);
		app.relaunch();
		app.exit(0);
	});
}
