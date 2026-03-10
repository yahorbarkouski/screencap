import { IpcChannels } from "../../../shared/ipc";
import type {
	GetMobileActivityDaysOptions,
	MobileActivityDay,
	MobileActivitySyncStatus,
} from "../../../shared/types";
import {
	getMobileActivitySyncStatus,
	listMobileActivityDays,
	syncMobileActivityDays,
} from "../../features/mobileActivity";
import { secureHandle } from "../secure";
import {
	ipcGetMobileActivityDaysArgs,
	ipcNoArgs,
	ipcSyncMobileActivityArgs,
} from "../validation";

export function registerMobileActivityHandlers(): void {
	secureHandle(
		IpcChannels.MobileActivity.ListDays,
		ipcGetMobileActivityDaysArgs,
		(options: GetMobileActivityDaysOptions): MobileActivityDay[] => {
			return listMobileActivityDays(options);
		},
	);

	secureHandle(
		IpcChannels.MobileActivity.Sync,
		ipcSyncMobileActivityArgs,
		async (options?: GetMobileActivityDaysOptions) => {
			return await syncMobileActivityDays(options);
		},
	);

	secureHandle(
		IpcChannels.MobileActivity.GetSyncStatus,
		ipcNoArgs,
		(): MobileActivitySyncStatus => {
			return getMobileActivitySyncStatus();
		},
	);
}
