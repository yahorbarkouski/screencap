import { IpcChannels, IpcEvents } from "../../../shared/ipc";
import type { Settings } from "../../../shared/types";
import { applyLaunchAtLoginSetting } from "../../app/loginItem";
import { isSchedulerRunning, startScheduler } from "../../features/scheduler";
import {
	startDayWrappedPublisher,
	stopDayWrappedPublisher,
} from "../../features/socialFeed";
import { triggerRetentionCleanupAfterSettingsChange } from "../../features/retention";
import { applyShortcuts } from "../../features/shortcuts";
import { getSettings, setSettings } from "../../infra/settings";
import { testBackendConnection } from "../../infra/settings/BackendConfig";
import { broadcast } from "../../infra/windows/broadcast";
import { secureHandle } from "../secure";
import { ipcNoArgs, ipcSetSettingsArgs } from "../validation";

export function registerSettingsHandlers(): void {
	secureHandle(IpcChannels.Settings.Get, ipcNoArgs, () => {
		return getSettings();
	});

	secureHandle(
		IpcChannels.Settings.Set,
		ipcSetSettingsArgs,
		(settings: Settings) => {
			const previous = getSettings();
			setSettings(settings);
			applyShortcuts(settings);
			if (
				previous.social.dayWrapped.enabled !== settings.social.dayWrapped.enabled
			) {
				if (settings.social.dayWrapped.enabled) {
					startDayWrappedPublisher();
				} else {
					stopDayWrappedPublisher();
				}
			}
			if (
				previous.captureInterval !== settings.captureInterval &&
				isSchedulerRunning()
			) {
				startScheduler(settings.captureInterval);
			}
			if (previous.retentionDays !== settings.retentionDays) {
				triggerRetentionCleanupAfterSettingsChange();
			}
			if (previous.launchAtLogin !== settings.launchAtLogin) {
				applyLaunchAtLoginSetting(settings.launchAtLogin);
			}
			broadcast(IpcEvents.SettingsChanged, settings);
		},
	);

	secureHandle(
		IpcChannels.Settings.TestBackendConnection,
		ipcNoArgs,
		async () => {
			return testBackendConnection();
		},
	);
}
