import { existsSync, readFileSync, realpathSync } from "node:fs";
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
import { IpcChannels } from "../../../shared/ipc";
import type { AppInfo } from "../../../shared/types";
import { getScreenshotsDir } from "../../infra/paths";
import { secureHandle } from "../secure";
import {
	ipcCopyImageArgs,
	ipcNoArgs,
	ipcOpenExternalArgs,
} from "../validation";

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
}
