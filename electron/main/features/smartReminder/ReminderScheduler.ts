import { Notification } from "electron";
import { getMainWindow, showMainWindow } from "../../app/window";
import {
	getDueReminders,
	markReminderTriggered,
} from "../../infra/db/repositories/ReminderRepository";
import { createLogger } from "../../infra/log";
import {
	broadcastRemindersChanged,
	broadcastReminderTriggered,
} from "../../infra/windows";

const logger = createLogger({ scope: "ReminderScheduler" });

const POLL_INTERVAL_MS = 30_000;

let interval: NodeJS.Timeout | null = null;
let inFlight = false;

function safeIsNotificationsSupported(): boolean {
	const fn = (Notification as unknown as { isSupported?: () => boolean })
		.isSupported;
	if (typeof fn === "function") {
		try {
			return fn();
		} catch {
			return false;
		}
	}
	return true;
}

function truncate(text: string, max = 100): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function showReminderNotification(params: {
	id: string;
	title: string;
	body: string | null;
}): void {
	if (!safeIsNotificationsSupported()) return;

	try {
		const notification = new Notification({
			title: truncate(params.title, 50),
			body: params.body ? truncate(params.body, 100) : "Reminder",
			silent: false,
		});

		notification.on("click", () => {
			showMainWindow();
			const win = getMainWindow();
			if (win && !win.isDestroyed()) {
				win.webContents.send("navigate:reminders");
			}
		});

		notification.show();
	} catch (error) {
		logger.warn("Failed to show reminder notification", {
			error: String(error),
		});
	}
}

async function pollOnce(): Promise<void> {
	if (inFlight) return;
	inFlight = true;

	try {
		const dueReminders = getDueReminders();

		for (const reminder of dueReminders) {
			logger.info("Triggering reminder", {
				id: reminder.id,
				title: reminder.title,
			});

			markReminderTriggered(reminder.id);

			showReminderNotification({
				id: reminder.id,
				title: reminder.title,
				body: reminder.body,
			});

			broadcastReminderTriggered(reminder);
		}

		if (dueReminders.length > 0) {
			broadcastRemindersChanged();
		}
	} catch (error) {
		logger.error("Reminder poll failed", { error: String(error) });
	} finally {
		inFlight = false;
	}
}

export function startReminderScheduler(): void {
	if (interval) return;

	void pollOnce();

	interval = setInterval(() => {
		void pollOnce();
	}, POLL_INTERVAL_MS);

	logger.info("Reminder scheduler started", { intervalMs: POLL_INTERVAL_MS });
}

export function stopReminderScheduler(): void {
	if (!interval) return;
	clearInterval(interval);
	interval = null;
	inFlight = false;
	logger.info("Reminder scheduler stopped");
}

export function isReminderSchedulerRunning(): boolean {
	return interval !== null;
}
