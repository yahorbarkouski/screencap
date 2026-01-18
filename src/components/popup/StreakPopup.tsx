import { addDays, endOfDay, format, startOfDay, subDays } from "date-fns";
import {
	AppWindow,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Flame,
	LayoutGrid,
	User,
	Users,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShortcutKbd } from "@/components/ui/shortcut-kbd";
import { useSettings } from "@/hooks/useSettings";
import { computeDaylineSlots, SLOTS_PER_HOUR } from "@/lib/dayline";
import type { Event, SharedEvent } from "@/types";
import { AvatarDisplay } from "./AvatarDisplay";
import {
	Dayline,
	DaylineTimeMarkers,
	type DaylineViewMode,
	DayWrappedLegend,
	VIEW_MODE_ORDER,
} from "./Dayline";
import { SocialTray, type SocialTrayTopHeaderState } from "./SocialTray";
import { useLockBodyScroll } from "./useLockBodyScroll";
import { usePopupAutoHeight } from "./usePopupAutoHeight";

export function StreakPopup() {
	const [events, setEvents] = useState<Event[]>([]);
	const [hasPreviousDays, setHasPreviousDays] = useState(true);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [isQuitConfirmOpen, setIsQuitConfirmOpen] = useState(false);
	const [daylineMode, setDaylineMode] = useState<DaylineViewMode>("categories");
	const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
	const [view, setView] = useState<"day" | "social">("day");
	const [day, setDay] = useState(() => startOfDay(new Date()));
	const { settings } = useSettings();
	const [socialSelectedEvent, setSocialSelectedEvent] =
		useState<SharedEvent | null>(null);
	const [socialTopHeader, setSocialTopHeader] =
		useState<SocialTrayTopHeaderState | null>(null);

	const handleLabelToggle = useCallback((label: string) => {
		setSelectedLabels((prev) => {
			const next = new Set(prev);
			if (next.has(label)) {
				next.delete(label);
			} else {
				next.add(label);
			}
			return next;
		});
	}, []);

	useEffect(() => {
		setSelectedLabels(new Set());
	}, []);

	useEffect(() => {
		if (view !== "social" && socialSelectedEvent) {
			setSocialSelectedEvent(null);
		}
	}, [socialSelectedEvent, view]);
	const todayStartMs = useMemo(() => startOfDay(new Date()).getTime(), []);
	const dayStartMs = useMemo(() => startOfDay(day).getTime(), [day]);
	const dayEndMs = useMemo(() => endOfDay(day).getTime(), [day]);
	const canGoForward = dayStartMs < todayStartMs;

	useLockBodyScroll(true);
	usePopupAutoHeight(rootRef);

	useEffect(() => {
		const fetchEvents = async () => {
			if (!window.api) return;
			const result = await window.api.storage.getEvents({
				startDate: dayStartMs,
				endDate: dayEndMs,
				dismissed: false,
			});
			setEvents(result);
		};
		void fetchEvents();
		const interval = setInterval(fetchEvents, 30000);
		return () => clearInterval(interval);
	}, [dayEndMs, dayStartMs]);

	useEffect(() => {
		const checkPreviousDays = async () => {
			if (!window.api) return;
			const result = await window.api.storage.getEvents({
				endDate: todayStartMs - 1,
				limit: 1,
				dismissed: false,
			});
			setHasPreviousDays(result.length > 10);
		};
		void checkPreviousDays();
	}, [todayStartMs]);

	const slots = useMemo(
		() =>
			computeDaylineSlots(events, dayStartMs, {
				showDominantWebsites: settings.showDominantWebsites,
			}),
		[events, dayStartMs, settings.showDominantWebsites],
	);
	const titleDate = format(day, "EEE, MMM d");

	const isToday = dayStartMs === todayStartMs;
	const isEvening = useMemo(() => new Date().getHours() >= 19, []);
	const currentSlotIdx = useMemo(() => {
		if (!isToday) return null;
		const now = new Date();
		const hour = now.getHours();
		const minute = now.getMinutes();
		return hour * SLOTS_PER_HOUR + Math.floor(minute / 10);
	}, [isToday]);

	const triggerCaptureNow = useCallback(() => {
		if (!window.api) return;
		void window.api.capture.trigger();
		window.close();
	}, []);

	const triggerProjectProgressCapture = useCallback(() => {
		if (!window.api?.popup?.startProjectProgressCapture) return;
		void window.api.popup.startProjectProgressCapture();
		window.close();
	}, []);

	const triggerEndOfDay = useCallback(() => {
		if (!window.api?.eod?.openFlow) return;
		void window.api.eod.openFlow();
		window.close();
	}, []);

	const triggerSmartReminder = useCallback(() => {
		if (!window.api?.reminders?.startCapture) return;
		void window.api.reminders.startCapture();
		window.close();
	}, []);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("shortcut:capture-now", () => {
			triggerCaptureNow();
		});
	}, [triggerCaptureNow]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("popup:reset-to-personal", () => {
			setView("day");
		});
	}, []);

	return (
		<div
			ref={rootRef}
			className="relative w-full bg-background/95 backdrop-blur-xl p-4 pt-2 pr-3 rounded-xl border border-border"
		>
			{isQuitConfirmOpen && (
				<div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
					<div className="w-full max-w-[320px] rounded-lg border border-border bg-background p-4 shadow-xl">
						<div className="text-sm font-medium text-foreground">
							Quit Screencap?
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							This will stop capturing until you reopen the app.
						</div>
						<div className="mt-4 grid grid-cols-2 gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => setIsQuitConfirmOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => {
									if (!window.api) return;
									void window.api.app.quit();
								}}
							>
								Quit
							</Button>
						</div>
					</div>
				</div>
			)}

			<div className="flex items-center justify-between pr-0.5">
				<div className="flex items-center gap-1.5">
					{view === "social" && socialTopHeader ? (
						<div className="flex items-center gap-1 min-w-0">
							<button
								type="button"
								aria-label="Back"
								className="inline-flex size-4 items-center mr-1 justify-center rounded-md border border-border bg-background/30 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground shrink-0"
								onClick={() => socialTopHeader.onBack()}
							>
								<ChevronLeft className="size-2" />
							</button>
							<div
								className={`flex items-center gap-1 min-w-0 ${socialTopHeader.kind === "event" && socialTopHeader.onUserClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
								onClick={
									socialTopHeader.kind === "event" &&
									socialTopHeader.onUserClick
										? socialTopHeader.onUserClick
										: undefined
								}
								onKeyDown={
									socialTopHeader.kind === "event" &&
									socialTopHeader.onUserClick
										? (e) => {
												if (e.key === "Enter" || e.key === " ") {
													socialTopHeader.onUserClick?.();
												}
											}
										: undefined
								}
								role={
									socialTopHeader.kind === "event" &&
									socialTopHeader.onUserClick
										? "button"
										: undefined
								}
								tabIndex={
									socialTopHeader.kind === "event" &&
									socialTopHeader.onUserClick
										? 0
										: undefined
								}
							>
								<AvatarDisplay
									username={socialTopHeader.username}
									size="xs"
									isOwn={
										socialTopHeader.kind === "event"
											? socialTopHeader.isOwn
											: undefined
									}
									ownAvatarUrl={
										socialTopHeader.kind === "event"
											? socialTopHeader.ownAvatarUrl
											: undefined
									}
									avatarSettings={socialTopHeader.avatarSettings}
								/>
								<div className="text-xs font-medium text-foreground/90 truncate">
									{socialTopHeader.username}
								</div>
							</div>
						</div>
					) : (
						<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
							{view === "day" ? "DAY WRAPPED" : "FEED"}
						</div>
					)}
					{view === "day" && (
						<>
							<button
								type="button"
								aria-label="Previous day"
								className="inline-flex size-4 items-center justify-center rounded-md border border-border bg-background/30 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
								onClick={() => setDay((d) => startOfDay(subDays(d, 1)))}
							>
								<ChevronLeft className="size-2" />
							</button>
							<button
								type="button"
								aria-label="Next day"
								disabled={!canGoForward}
								className={`inline-flex size-4 items-center justify-center rounded-md border border-border bg-background/30 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground ${canGoForward ? "" : "pointer-events-none opacity-0"}`}
								onClick={() => setDay((d) => startOfDay(addDays(d, 1)))}
							>
								<ChevronRight className="size-2" />
							</button>
						</>
					)}
				</div>
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						aria-label={`View: ${view === "day" ? "My Day" : "Social"}`}
						className={`inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground ${hasPreviousDays ? "size-6" : "h-6 px-2 text-[10px] font-medium"}`}
						onClick={() => setView((v) => (v === "day" ? "social" : "day"))}
					>
						{hasPreviousDays ? (
							view === "day" ? (
								<User className="size-3.5" />
							) : (
								<Users className="size-3.5" />
							)
						) : view === "day" ? (
							<div className="flex items-center gap-1">
								<Users className="size-3.5" />
								Friends
							</div>
						) : (
							<div className="flex items-center gap-1">
								<User className="size-3.5" />
								Me
							</div>
						)}
					</button>
					<button
						type="button"
						aria-label="Close"
						className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
						onClick={() => window.close()}
					>
						<X className="size-3" />
					</button>
				</div>
			</div>

			<div style={{ display: view === "day" ? "block" : "none" }}>
				<div className="mt-1 pr-1">
					<div className="flex items-center justify-between mb-3">
						<div className="text-sm font-medium text-foreground/90">
							{titleDate}
						</div>
						<button
							type="button"
							aria-label={`View: ${daylineMode}`}
							className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
							onClick={() =>
								setDaylineMode((m) => {
									const idx = VIEW_MODE_ORDER.indexOf(m);
									return VIEW_MODE_ORDER[(idx + 1) % VIEW_MODE_ORDER.length];
								})
							}
						>
							{daylineMode === "categories" && (
								<LayoutGrid className="size-3" />
							)}
							{daylineMode === "addiction" && <Flame className="size-3" />}
							{daylineMode === "apps" && <AppWindow className="size-3" />}
						</button>
					</div>

					<Dayline
						slots={slots}
						mode={daylineMode}
						currentSlotIdx={currentSlotIdx}
						selectedLabels={selectedLabels}
					/>
					<DaylineTimeMarkers
						slots={slots}
						mode={daylineMode}
						selectedLabels={selectedLabels}
					/>

					<DayWrappedLegend
						slots={slots}
						mode={daylineMode}
						selectedLabels={selectedLabels}
						onLabelToggle={handleLabelToggle}
					/>

					<div className="mt-4 grid grid-cols-2 gap-2">
						<Button
							size="sm"
							variant="outline"
							className="w-full hover:bg-primary/10"
							onClick={() => {
								window.api?.window.show();
								window.close();
							}}
							disabled={!window.api}
						>
							Open app
						</Button>

						<DropdownMenu>
							<div className="flex w-full">
								<Button
									size="sm"
									className={`flex-1 justify-center rounded-r-none ${
										isEvening
											? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
											: "bg-green-800/20 text-green-500 hover:bg-green-800/30"
									}`}
									onClick={
										isEvening ? triggerEndOfDay : triggerProjectProgressCapture
									}
									disabled={!window.api}
								>
									<span>{isEvening ? "End of day" : "Capture progress"}</span>
								</Button>
								<DropdownMenuTrigger asChild>
									<Button
										size="sm"
										className={`rounded-l-none px-2 border-l border-green-800/10 ${
											isEvening
												? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
												: "bg-green-800/20 text-green-500 hover:bg-green-800/30"
										}`}
										disabled={!window.api}
										aria-label="More actions"
									>
										<ChevronDown className="size-3" />
									</Button>
								</DropdownMenuTrigger>
							</div>
							<DropdownMenuContent
								align="end"
								side="top"
								avoidCollisions={false}
							>
								<DropdownMenuItem
									onSelect={
										isEvening ? triggerProjectProgressCapture : triggerEndOfDay
									}
									className="flex items-center justify-between gap-3"
								>
									<span>{isEvening ? "Capture progress" : "End of day"}</span>
									<ShortcutKbd
										accelerator={
											isEvening
												? settings.shortcuts.captureProjectProgress
												: settings.shortcuts.endOfDay
										}
										className="h-4 px-1 text-[9px] rounded-sm"
									/>
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={triggerCaptureNow}
									className="flex items-center justify-between gap-3"
								>
									<span>Capture now</span>
									<ShortcutKbd
										accelerator={settings.shortcuts.captureNow}
										className="h-4 px-1 text-[9px] rounded-sm"
									/>
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={triggerSmartReminder}
									className="flex items-center justify-between gap-3"
								>
									<span>Smart reminder</span>
									<ShortcutKbd
										accelerator={settings.shortcuts.smartReminder}
										className="h-4 px-1 text-[9px] rounded-sm"
									/>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>
			<div
				className="mt-2"
				style={{ display: view === "social" ? "block" : "none" }}
			>
				<SocialTray
					selectedEvent={socialSelectedEvent}
					onSelectedEventChange={setSocialSelectedEvent}
					onTopHeaderChange={setSocialTopHeader}
					useExternalHeader
				/>
			</div>
		</div>
	);
}
