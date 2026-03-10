import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type { DevicePairingSession, PairedDevice } from "../../../shared/types";
import {
	approveDevicePairingSession,
	createDevicePairingSession,
	getDevicePairingSession,
	listPairedDevices,
	revokePairedDevice,
} from "../../features/mobileActivity";
import { secureHandle } from "../secure";
import { ipcIdArgs, ipcNoArgs } from "../validation";

const sessionArgs = z.tuple([z.string().trim().min(1).max(256)]);

export function registerDevicePairingHandlers(): void {
	secureHandle(
		IpcChannels.DevicePairing.CreateSession,
		ipcNoArgs,
		async (): Promise<DevicePairingSession> => {
			return await createDevicePairingSession();
		},
	);

	secureHandle(
		IpcChannels.DevicePairing.GetSession,
		sessionArgs,
		async (sessionId: string): Promise<DevicePairingSession | null> => {
			return await getDevicePairingSession(sessionId);
		},
	);

	secureHandle(
		IpcChannels.DevicePairing.ApproveSession,
		sessionArgs,
		async (sessionId: string): Promise<DevicePairingSession | null> => {
			return await approveDevicePairingSession(sessionId);
		},
	);

	secureHandle(
		IpcChannels.DevicePairing.ListDevices,
		ipcNoArgs,
		async (): Promise<PairedDevice[]> => {
			return await listPairedDevices();
		},
	);

	secureHandle(
		IpcChannels.DevicePairing.RevokeDevice,
		ipcIdArgs,
		async (deviceId: string): Promise<void> => {
			await revokePairedDevice(deviceId);
		},
	);
}
