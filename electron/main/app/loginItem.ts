import { app } from "electron";
import { createLogger } from "../infra/log";
import { getSettings } from "../infra/settings";

const logger = createLogger({ scope: "LoginItem" });

const LOGIN_ITEM_ARGS = ["--autostart", "--hidden"] as const;

function isSupportedPlatform(platform: NodeJS.Platform): boolean {
	return platform === "darwin" || platform === "win32";
}

export function shouldStartHiddenFromLaunchContext(): boolean {
	const settings = getSettings();
	if (!settings.onboarding?.completedAt) {
		logger.info("First launch detected, showing window");
		return false;
	}

	if (
		process.argv.includes("--hidden") ||
		process.argv.includes("--autostart")
	) {
		return true;
	}
	if (!isSupportedPlatform(process.platform)) return false;
	try {
		const info = app.getLoginItemSettings();
		return Boolean(info.wasOpenedAtLogin || info.wasOpenedAsHidden);
	} catch {
		return false;
	}
}

export function applyLaunchAtLoginSetting(enabled: boolean): void {
	if (!isSupportedPlatform(process.platform)) return;
	if (!app.isPackaged) return;

	try {
		const current = app.getLoginItemSettings();
		if (current.openAtLogin === enabled) return;
	} catch {}

	const args = enabled ? [...LOGIN_ITEM_ARGS] : [];

	try {
		if (process.platform === "win32") {
			app.setLoginItemSettings({
				openAtLogin: enabled,
				openAsHidden: enabled,
				path: process.execPath,
				args,
			});
		} else {
			app.setLoginItemSettings({
				openAtLogin: enabled,
				openAsHidden: enabled,
				args,
			});
		}
		logger.info("Login item updated", { enabled });
	} catch (error) {
		logger.warn("Failed to update login item", {
			enabled,
			error: String(error),
		});
	}
}
