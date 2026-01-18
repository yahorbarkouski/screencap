import { IpcChannels } from "../../../shared/ipc";
import type {
	GetRemindersOptions,
	ReminderInput,
	ReminderUpdate,
} from "../../../shared/types";
import {
	deleteReminder,
	getReminderById,
	getReminders,
	insertReminder,
	markReminderCompleted,
	updateReminder,
} from "../../infra/db/repositories/ReminderRepository";
import { broadcastRemindersChanged } from "../../infra/windows";
import { secureHandle } from "../secure";
import {
	ipcCreateReminderArgs,
	ipcGetRemindersArgs,
	ipcIdArgs,
	ipcNoArgs,
	ipcUpdateReminderArgs,
} from "../validation";

export function registerRemindersHandlers(): void {
	secureHandle(
		IpcChannels.Reminders.List,
		ipcGetRemindersArgs,
		(options?: GetRemindersOptions) => {
			return getReminders(options);
		},
	);

	secureHandle(IpcChannels.Reminders.Get, ipcIdArgs, (id: string) => {
		return getReminderById(id);
	});

	secureHandle(
		IpcChannels.Reminders.Create,
		ipcCreateReminderArgs,
		(input: ReminderInput) => {
			const reminder = insertReminder(input);
			broadcastRemindersChanged();
			return reminder;
		},
	);

	secureHandle(
		IpcChannels.Reminders.Update,
		ipcUpdateReminderArgs,
		(id: string, updates: ReminderUpdate) => {
			updateReminder(id, updates);
			broadcastRemindersChanged();
		},
	);

	secureHandle(IpcChannels.Reminders.Delete, ipcIdArgs, (id: string) => {
		deleteReminder(id);
		broadcastRemindersChanged();
	});

	secureHandle(IpcChannels.Reminders.MarkCompleted, ipcIdArgs, (id: string) => {
		markReminderCompleted(id);
		broadcastRemindersChanged();
	});

	secureHandle(IpcChannels.Reminders.StartCapture, ipcNoArgs, async () => {
		const { startSmartReminderCapture } = await import(
			"../../features/smartReminder/SmartReminderCaptureService"
		);
		await startSmartReminderCapture();
	});
}
