import type { BrowserWindow } from "electron";
import { IpcChannels } from "../../../shared/ipc";
import { hideMainWindow, showMainWindow } from "../../app/window";
import { secureHandle } from "../secure";
import { ipcNoArgs } from "../validation";

export function registerWindowHandlers(
	getMainWindow: () => BrowserWindow | null,
): void {
	secureHandle(IpcChannels.Window.Minimize, ipcNoArgs, () => {
		getMainWindow()?.minimize();
	});

	secureHandle(IpcChannels.Window.Maximize, ipcNoArgs, () => {
		const win = getMainWindow();
		if (win?.isMaximized()) {
			win.unmaximize();
		} else {
			win?.maximize();
		}
	});

	secureHandle(IpcChannels.Window.Show, ipcNoArgs, () => {
		showMainWindow();
	});

	secureHandle(IpcChannels.Window.Close, ipcNoArgs, () => {
		hideMainWindow({ hideFromDock: false });
	});
}
