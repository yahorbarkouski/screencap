import { Bell, Check, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Reminder } from "@/types";

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = timestamp - now;
	const absDiff = Math.abs(diff);

	if (absDiff < 60_000) {
		return diff > 0 ? "in less than a minute" : "just now";
	}

	const minutes = Math.floor(absDiff / 60_000);
	if (minutes < 60) {
		const unit = minutes === 1 ? "minute" : "minutes";
		return diff > 0 ? `in ${minutes} ${unit}` : `${minutes} ${unit} ago`;
	}

	const hours = Math.floor(absDiff / 3_600_000);
	if (hours < 24) {
		const unit = hours === 1 ? "hour" : "hours";
		return diff > 0 ? `in ${hours} ${unit}` : `${hours} ${unit} ago`;
	}

	const days = Math.floor(absDiff / 86_400_000);
	const unit = days === 1 ? "day" : "days";
	return diff > 0 ? `in ${days} ${unit}` : `${days} ${unit} ago`;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

interface ReminderCardProps {
	reminder: Reminder;
	onComplete: (id: string) => void;
	onDelete: (id: string) => void;
}

function ReminderCard({ reminder, onComplete, onDelete }: ReminderCardProps) {
	const isNote = reminder.remindAt === null;
	const isPast = reminder.remindAt !== null && reminder.remindAt < Date.now();
	const isCompleted = reminder.status === "completed";
	const bodyText = reminder.body ?? reminder.sourceText ?? "";
	const metaItems = [
		reminder.urlHost,
		reminder.contentKind,
		reminder.appBundleId,
	].filter(Boolean);

	return (
		<div
			className={`group relative rounded-lg border p-4 transition-colors ${
				isCompleted
					? "border-neutral-700 bg-neutral-800/50 opacity-60"
					: isPast
						? "border-amber-600/50 bg-amber-900/10"
						: "border-neutral-700 bg-neutral-800/80 hover:border-neutral-600"
			}`}
		>
			<div className="flex items-start gap-3">
				{reminder.thumbnailPath && (
					<img
						src={`local-file://${reminder.thumbnailPath}`}
						alt=""
						className="h-16 w-24 flex-shrink-0 rounded object-cover"
					/>
				)}
				<div className="min-w-0 flex-1">
					<h3
						className={`font-medium ${isCompleted ? "line-through text-neutral-400" : "text-white"}`}
					>
						{reminder.title}
					</h3>
					{bodyText && (
						<p className="mt-1 whitespace-pre-wrap text-sm text-neutral-300 break-words">
							{bodyText}
						</p>
					)}
					<div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
						{isNote ? (
							<span>Note</span>
						) : (
							<>
								<Bell className="h-3 w-3" />
								<span>{formatRelativeTime(reminder.remindAt as number)}</span>
								<span className="text-neutral-600">
									({formatDate(reminder.remindAt as number)})
								</span>
							</>
						)}
					</div>
					{reminder.windowTitle && (
						<div className="mt-2 text-xs text-neutral-500">
							{reminder.windowTitle}
						</div>
					)}
					{metaItems.length > 0 && (
						<div className="mt-1 text-xs text-neutral-600">
							{metaItems.join(" · ")}
						</div>
					)}
				</div>
				<div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
					{!isCompleted && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							onClick={() => onComplete(reminder.id)}
						>
							<Check className="h-4 w-4" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-red-400 hover:text-red-300"
						onClick={() => onDelete(reminder.id)}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

export function RemindersView() {
	const [reminders, setReminders] = useState<Reminder[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [showCompleted, setShowCompleted] = useState(false);

	const loadReminders = useCallback(async () => {
		if (!window.api?.reminders) return;
		const data = await window.api.reminders.list({ includeNotes: true });
		setReminders(data);
		setIsLoading(false);
	}, []);

	useEffect(() => {
		loadReminders();
	}, [loadReminders]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("reminders:changed", () => {
			loadReminders();
		});
	}, [loadReminders]);

	const handleComplete = useCallback(
		async (id: string) => {
			if (!window.api?.reminders) return;
			await window.api.reminders.markCompleted(id);
			loadReminders();
		},
		[loadReminders],
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!window.api?.reminders) return;
			await window.api.reminders.delete(id);
			loadReminders();
		},
		[loadReminders],
	);

	const handleStartCapture = useCallback(async () => {
		if (!window.api?.reminders) return;
		await window.api.reminders.startCapture();
	}, []);

	const upcomingReminders = reminders.filter(
		(r) =>
			r.status === "pending" && r.remindAt !== null && r.remindAt > Date.now(),
	);

	const pastReminders = reminders.filter(
		(r) =>
			r.status === "pending" && r.remindAt !== null && r.remindAt <= Date.now(),
	);

	const triggeredReminders = reminders.filter((r) => r.status === "triggered");

	const completedReminders = reminders.filter((r) => r.status === "completed");

	const notes = reminders.filter(
		(r) => r.remindAt === null && r.status !== "completed",
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-neutral-400">Loading...</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-neutral-900">
			<div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
				<div>
					<h1 className="text-xl font-semibold text-white">Reminders</h1>
					<p className="mt-1 text-sm text-neutral-400">
						Your notes and scheduled reminders
					</p>
				</div>
				<Button onClick={handleStartCapture} className="gap-2">
					<Plus className="h-4 w-4" />
					New Reminder
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				{reminders.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center text-center">
						<Bell className="h-12 w-12 text-neutral-600" />
						<h2 className="mt-4 text-lg font-medium text-white">
							No reminders yet
						</h2>
						<p className="mt-2 max-w-md text-sm text-neutral-400">
							Capture a screen region and add a note or reminder. Use the
							shortcut or click "New Reminder" to get started.
						</p>
					</div>
				) : (
					<div className="space-y-6">
						{pastReminders.length > 0 && (
							<section>
								<h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-amber-400">
									Overdue
								</h2>
								<div className="space-y-3">
									{pastReminders.map((r) => (
										<ReminderCard
											key={r.id}
											reminder={r}
											onComplete={handleComplete}
											onDelete={handleDelete}
										/>
									))}
								</div>
							</section>
						)}

						{upcomingReminders.length > 0 && (
							<section>
								<h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">
									Upcoming
								</h2>
								<div className="space-y-3">
									{upcomingReminders.map((r) => (
										<ReminderCard
											key={r.id}
											reminder={r}
											onComplete={handleComplete}
											onDelete={handleDelete}
										/>
									))}
								</div>
							</section>
						)}

						{triggeredReminders.length > 0 && (
							<section>
								<h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-amber-400">
									Triggered
								</h2>
								<div className="space-y-3">
									{triggeredReminders.map((r) => (
										<ReminderCard
											key={r.id}
											reminder={r}
											onComplete={handleComplete}
											onDelete={handleDelete}
										/>
									))}
								</div>
							</section>
						)}

						{notes.length > 0 && (
							<section>
								<h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">
									Notes
								</h2>
								<div className="space-y-3">
									{notes.map((r) => (
										<ReminderCard
											key={r.id}
											reminder={r}
											onComplete={handleComplete}
											onDelete={handleDelete}
										/>
									))}
								</div>
							</section>
						)}

						{completedReminders.length > 0 && (
							<section>
								<button
									type="button"
									onClick={() => setShowCompleted(!showCompleted)}
									className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-400"
								>
									Completed ({completedReminders.length})
									<span className="text-xs">{showCompleted ? "▼" : "▶"}</span>
								</button>
								{showCompleted && (
									<div className="space-y-3">
										{completedReminders.map((r) => (
											<ReminderCard
												key={r.id}
												reminder={r}
												onComplete={handleComplete}
												onDelete={handleDelete}
											/>
										))}
									</div>
								)}
							</section>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
