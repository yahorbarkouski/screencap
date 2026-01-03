import { IpcChannels, IpcEvents } from "../../../shared/ipc";
import type { EodEntryInput } from "../../../shared/types";
import { showMainWindow } from "../../app/window";
import {
	getEodEntryByDayStart,
	insertOrUpdateEodEntry,
	listEodEntries,
} from "../../infra/db/repositories/EodEntryRepository";
import { broadcast } from "../../infra/windows";
import { secureHandle } from "../secure";
import {
	ipcEodGetEntryByDayStartArgs,
	ipcEodListEntriesArgs,
	ipcEodOpenFlowArgs,
	ipcEodUpsertEntryArgs,
} from "../validation";

function startOfLocalDayMs(timestamp: number): number {
	const d = new Date(timestamp);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function registerEodHandlers(): void {
	secureHandle(
		IpcChannels.Eod.OpenFlow,
		ipcEodOpenFlowArgs,
		(options?: { dayStart?: number }) => {
			showMainWindow();
			const dayStart = startOfLocalDayMs(options?.dayStart ?? Date.now());
			broadcast(IpcEvents.ShortcutEndOfDay, { dayStart });
		},
	);

	secureHandle(
		IpcChannels.Eod.GetEntryByDayStart,
		ipcEodGetEntryByDayStartArgs,
		(dayStart: number) => {
			return getEodEntryByDayStart(dayStart);
		},
	);

	secureHandle(
		IpcChannels.Eod.UpsertEntry,
		ipcEodUpsertEntryArgs,
		(entry: EodEntryInput) => {
			insertOrUpdateEodEntry(entry);
		},
	);

	secureHandle(IpcChannels.Eod.ListEntries, ipcEodListEntriesArgs, () => {
		return listEodEntries();
	});
}
