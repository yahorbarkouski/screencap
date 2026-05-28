import type { BrowserWindow } from "electron";
import { createLogger } from "../infra/log";
import {
	registerAppHandlers,
	registerCaptureHandlers,
	registerEodHandlers,
	registerLLMHandlers,
	registerLogsHandlers,
	registerOcrHandlers,
	registerPermissionHandlers,
	registerPopupHandlers,
	registerProjectJournalHandlers,
	registerSchedulerHandlers,
	registerSettingsHandlers,
	registerShortcutsHandlers,
	registerStorageHandlers,
	registerUpdateHandlers,
	registerWindowHandlers,
} from "./handlers";

const logger = createLogger({ scope: "IPC" });

let registered = false;

export function registerAllHandlers(
	getMainWindow: () => BrowserWindow | null,
): void {
	if (registered) {
		logger.warn("IPC handlers already registered, skipping");
		return;
	}

	logger.info("Registering IPC handlers");

	registerAppHandlers();
	registerWindowHandlers(getMainWindow);
	registerPermissionHandlers();
	registerCaptureHandlers();
	registerSchedulerHandlers();
	registerStorageHandlers();
	registerSettingsHandlers();
	registerShortcutsHandlers();
	registerProjectJournalHandlers();
	registerLLMHandlers();
	registerLogsHandlers();
	registerOcrHandlers();
	registerPopupHandlers();
	registerUpdateHandlers();
	registerEodHandlers();

	registered = true;
	logger.info("IPC handlers registered");
}
