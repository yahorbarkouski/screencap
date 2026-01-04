import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { release } from "node:os";
import { app, clipboard, dialog, BrowserWindow } from "electron";
import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type { AppInfo, LogsCollectResult } from "../../../shared/types";
import { formatLogsForExport, getLogBuffer } from "../../infra/log";
import { secureHandle } from "../secure";

declare const __BUILD_DATE__: string | undefined;
declare const __GIT_SHA__: string | undefined;
declare const __RELEASE_CHANNEL__: string | undefined;

const ipcLogsCollectArgs = z.tuple([z.string().optional()]);

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

function buildLogsReport(rendererLogs?: string): LogsCollectResult {
	const mainLogs = getLogBuffer();
	const appInfo = getAppInfo();

	const sections: string[] = [];

	sections.push("=".repeat(60));
	sections.push("SCREENCAP DIAGNOSTIC REPORT");
	sections.push(`Generated: ${new Date().toISOString()}`);
	sections.push("=".repeat(60));

	sections.push("");
	sections.push("-".repeat(40));
	sections.push("SYSTEM INFO");
	sections.push("-".repeat(40));
	sections.push(`App: ${appInfo.name} v${appInfo.version}`);
	sections.push(`Packaged: ${appInfo.isPackaged}`);
	if (appInfo.buildDate) sections.push(`Build date: ${appInfo.buildDate}`);
	if (appInfo.gitSha) sections.push(`Git SHA: ${appInfo.gitSha}`);
	if (appInfo.releaseChannel) sections.push(`Channel: ${appInfo.releaseChannel}`);
	sections.push(`Electron: ${appInfo.electron}`);
	sections.push(`Chrome: ${appInfo.chrome}`);
	sections.push(`Node: ${appInfo.node}`);
	sections.push(`Platform: ${appInfo.platform} ${appInfo.arch}`);
	sections.push(`OS Version: ${appInfo.osVersion}`);

	sections.push("");
	sections.push("-".repeat(40));
	sections.push(`MAIN PROCESS LOGS (${mainLogs.length} entries)`);
	sections.push("-".repeat(40));
	sections.push(formatLogsForExport(mainLogs));

	if (rendererLogs) {
		sections.push("");
		sections.push("-".repeat(40));
		sections.push("RENDERER PROCESS LOGS");
		sections.push("-".repeat(40));
		sections.push(rendererLogs);
	}

	sections.push("");
	sections.push("=".repeat(60));
	sections.push("END OF REPORT");
	sections.push("=".repeat(60));

	return {
		logs: sections.join("\n"),
		entryCount: mainLogs.length,
		appInfo,
	};
}

export function registerLogsHandlers(): void {
	secureHandle(
		IpcChannels.Logs.Collect,
		ipcLogsCollectArgs,
		(rendererLogs?: string): LogsCollectResult => {
			return buildLogsReport(rendererLogs);
		},
	);

	secureHandle(
		IpcChannels.Logs.CopyToClipboard,
		ipcLogsCollectArgs,
		(rendererLogs?: string): void => {
			const result = buildLogsReport(rendererLogs);
			clipboard.writeText(result.logs);
		},
	);

	secureHandle(
		IpcChannels.Logs.SaveToFile,
		ipcLogsCollectArgs,
		async (rendererLogs?: string): Promise<string | null> => {
			const result = buildLogsReport(rendererLogs);
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const defaultPath = join(
				app.getPath("downloads"),
				`screencap-logs-${timestamp}.txt`,
			);

			const browserWindow = BrowserWindow.getFocusedWindow();
			const dialogResult = browserWindow
				? await dialog.showSaveDialog(browserWindow, {
						title: "Save Diagnostic Logs",
						defaultPath,
						filters: [{ name: "Text Files", extensions: ["txt"] }],
					})
				: await dialog.showSaveDialog({
						title: "Save Diagnostic Logs",
						defaultPath,
						filters: [{ name: "Text Files", extensions: ["txt"] }],
					});

			if (dialogResult.canceled || !dialogResult.filePath) {
				return null;
			}

			await writeFile(dialogResult.filePath, result.logs, "utf-8");
			return dialogResult.filePath;
		},
	);
}
