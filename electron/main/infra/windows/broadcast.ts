import { BrowserWindow } from "electron";
import { IpcEvents } from "../../../shared/ipc";

export function broadcast(channel: string, payload?: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, payload);
		}
	}
}

export function broadcastEventCreated(eventId: string): void {
	broadcast(IpcEvents.EventCreated, eventId);
}

export function broadcastEventUpdated(eventId: string): void {
	broadcast(IpcEvents.EventUpdated, eventId);
}

export function broadcastEventsChanged(): void {
	broadcast(IpcEvents.EventsChanged);
}

export function broadcastProjectsNormalized(result: {
	updatedRows: number;
	groups: number;
}): void {
	broadcast(IpcEvents.ProjectsNormalized, result);
}

export function broadcastPermissionRequired(): void {
	broadcast(IpcEvents.PermissionRequired);
}

export function broadcastRemindersChanged(): void {
	broadcast(IpcEvents.RemindersChanged);
}

export function broadcastReminderTriggered(reminder: unknown): void {
	broadcast(IpcEvents.ReminderTriggered, reminder);
}
