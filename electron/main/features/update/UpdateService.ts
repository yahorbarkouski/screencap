import { app } from "electron";
import pkg from "electron-updater";
import type { UpdateState, UpdateStatus } from "../../../shared/types";

const { autoUpdater } = pkg;
type UpdateInfo = pkg.UpdateInfo;
type ProgressInfo = pkg.ProgressInfo;

import { IpcEvents } from "../../../shared/ipc";
import { setIsQuitting } from "../../app/lifecycle";
import { setTrayUpdateReady } from "../../app/tray";
import { createLogger } from "../../infra/log";
import { broadcast } from "../../infra/windows";

const logger = createLogger({ scope: "Update" });

let state: UpdateState = {
	status: "idle",
	currentVersion: "0.0.0",
};

function updateState(partial: Partial<UpdateState>): void {
	state = { ...state, ...partial };
	broadcast(IpcEvents.UpdateState, state);
}

function setStatus(status: UpdateStatus): void {
	updateState({ status });
}

export function initializeUpdater(): void {
	state.currentVersion = app.getVersion();

	if (!app.isPackaged) {
		logger.info("Updates disabled in development mode");
		return;
	}

	autoUpdater.logger = {
		info: (message: string) => logger.info(message),
		warn: (message: string) => logger.warn(message),
		error: (message: string) => logger.error(message),
		debug: (message: string) => logger.info(message),
	};

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("checking-for-update", () => {
		logger.info("Checking for update...");
		setStatus("checking");
	});

	autoUpdater.on("update-available", (info: UpdateInfo) => {
		logger.info("Update available:", info.version);
		updateState({
			status: "available",
			availableVersion: info.version,
			releaseNotes:
				typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
			publishedAt: info.releaseDate,
			lastCheckedAt: Date.now(),
		});
	});

	autoUpdater.on("update-not-available", () => {
		logger.info("No update available");
		updateState({
			status: "not_available",
			lastCheckedAt: Date.now(),
		});
	});

	autoUpdater.on("download-progress", (progress: ProgressInfo) => {
		updateState({
			status: "downloading",
			progress: {
				percent: progress.percent,
				transferred: progress.transferred,
				total: progress.total,
				bytesPerSecond: progress.bytesPerSecond,
			},
		});
	});

	autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
		logger.info("Update downloaded:", info.version);
		updateState({
			status: "downloaded",
			availableVersion: info.version,
			progress: undefined,
		});
		setTrayUpdateReady(true);
	});

	autoUpdater.on("error", (error: Error) => {
		logger.error("Update error:", error);
		updateState({
			status: "error",
			error: {
				message: error.message,
				code: (error as NodeJS.ErrnoException).code,
			},
			progress: undefined,
		});
	});

	setTimeout(() => {
		checkForUpdates();
	}, 30000);

	setInterval(
		() => {
			checkForUpdates();
		},
		6 * 60 * 60 * 1000,
	);
}

export function getUpdateState(): UpdateState {
	return { ...state };
}

export function checkForUpdates(): void {
	if (!app.isPackaged) {
		logger.info("Updates disabled in development mode");
		updateState({
			status: "not_available",
			lastCheckedAt: Date.now(),
		});
		return;
	}

	if (state.status === "checking" || state.status === "downloading") {
		logger.info("Already checking or downloading");
		return;
	}

	autoUpdater.checkForUpdates().catch((error) => {
		logger.error("Failed to check for updates:", error);
		updateState({
			status: "error",
			error: { message: error.message },
			lastCheckedAt: Date.now(),
		});
	});
}

export function downloadUpdate(): void {
	if (!app.isPackaged) {
		logger.info("Updates disabled in development mode");
		return;
	}

	if (state.status !== "available") {
		logger.warn("No update available to download");
		return;
	}

	autoUpdater.downloadUpdate().catch((error) => {
		logger.error("Failed to download update:", error);
		updateState({
			status: "error",
			error: { message: error.message },
		});
	});
}

export function restartAndInstall(): void {
	if (!app.isPackaged) {
		logger.info("Updates disabled in development mode");
		return;
	}

	if (state.status !== "downloaded") {
		logger.warn("No update downloaded to install");
		return;
	}

	logger.info("Restarting to install update");
	setTrayUpdateReady(false);
	setIsQuitting(true);
	autoUpdater.quitAndInstall();
}
