import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { PermissionDialog } from "@/components/dialogs/PermissionDialog";
import { EndOfDayFlow } from "@/components/eod/EndOfDayFlow";
import { AppBackdrop } from "@/components/layout/AppBackdrop";
import { Sidebar } from "@/components/layout/Sidebar";
import { Titlebar } from "@/components/layout/Titlebar";
import { AddictionsView } from "@/components/memory/AddictionsView";
import { ProjectsView } from "@/components/memory/ProjectsView";
import { OnboardingWizard } from "@/components/onboarding";
import { EventPreviewModal } from "@/components/preview/EventPreviewModal";
import { ProjectProgressView } from "@/components/progress/ProjectProgressView";
import { RemindersView } from "@/components/reminders/RemindersView";
import { SettingsView } from "@/components/settings/SettingsView";
import { StoryView } from "@/components/story/StoryView";
import { Timeline } from "@/components/timeline/Timeline";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMemories } from "@/hooks/useMemories";
import { usePermission } from "@/hooks/usePermission";
import { useSettings } from "@/hooks/useSettings";
import { getLogicalDayStart } from "@/lib/dayBoundary";
import { useAppStore } from "@/stores/app";
import type { SettingsTab, SharedEvent } from "@/types";

const ONBOARDING_VERSION = 1;

export default function App() {
	const view = useAppStore((s) => s.view);
	const setView = useAppStore((s) => s.setView);
	const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
	const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
	const openEod = useAppStore((s) => s.openEod);
	const settingsLoaded = useAppStore((s) => s.settingsLoaded);
	const setSettingsTab = useAppStore((s) => s.setSettingsTab);
	const previewEvent = useAppStore((s) => s.previewEvent);
	const setPreviewEvent = useAppStore((s) => s.setPreviewEvent);
	const { hasPermission, checkPermission } = usePermission();
	const { settings } = useSettings();
	useMemories();
	const [showPermissionDialog, setShowPermissionDialog] = useState(false);
	const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

	const onboarding = settings.onboarding;
	const needsOnboarding =
		onboarding?.completedAt == null ||
		(onboarding?.version ?? 0) < ONBOARDING_VERSION;

	useEffect(() => {
		if (!settingsLoaded) return;
		if (showOnboarding === null) {
			setShowOnboarding(needsOnboarding);
		}
	}, [needsOnboarding, settingsLoaded, showOnboarding]);

	useEffect(() => {
		if (showOnboarding === false) {
			checkPermission().then((hasPerm) => {
				setShowPermissionDialog(!hasPerm);
			});
		}
	}, [showOnboarding, checkPermission]);

	useEffect(() => {
		if (!hasPermission && showOnboarding === false) {
			setShowPermissionDialog(true);
		}
	}, [hasPermission, showOnboarding]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setCommandPaletteOpen(!commandPaletteOpen);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [commandPaletteOpen, setCommandPaletteOpen]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("shortcut:end-of-day", (payload) => {
			const dayStart =
				payload &&
				typeof payload === "object" &&
				"dayStart" in payload &&
				typeof (payload as { dayStart?: unknown }).dayStart === "number"
					? (payload as { dayStart: number }).dayStart
					: getLogicalDayStart(Date.now());
			openEod(dayStart);
		});
	}, [openEod]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("preview:event", (event) => {
			if (event && typeof event === "object") {
				setPreviewEvent(event as SharedEvent);
			}
		});
	}, [setPreviewEvent]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("settings:open-tab", (payload) => {
			if (typeof payload !== "string") return;
			const tab =
				payload === "capture" ||
				payload === "ai" ||
				payload === "automation" ||
				payload === "data" ||
				payload === "social" ||
				payload === "system"
					? (payload as SettingsTab)
					: null;
			if (!tab) return;
			setSettingsTab(tab);
			setView("settings");
		});
	}, [setSettingsTab, setView]);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("navigate:reminders" as never, () => {
			setView("reminders");
		});
	}, [setView]);

	const handleOnboardingComplete = useCallback(() => {
		setShowOnboarding(false);
		checkPermission();
	}, [checkPermission]);

	if (showOnboarding === null) {
		return null;
	}

	if (showOnboarding) {
		return (
			<TooltipProvider>
				<OnboardingWizard onComplete={handleOnboardingComplete} />
			</TooltipProvider>
		);
	}

	return (
		<TooltipProvider>
			<div className="relative flex h-screen flex-col overflow-hidden bg-background">
				<AppBackdrop />
				<Titlebar />
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<Sidebar />
					<main className="relative flex-1 overflow-hidden rounded-tl-xl border-l border-t border-border">
						{view === "timeline" && <Timeline />}
						{view === "progress" && <ProjectProgressView />}
						{view === "story" && <StoryView />}
						{view === "projects" && <ProjectsView />}
						{view === "addictions" && <AddictionsView />}
						{view === "reminders" && <RemindersView />}
						{view === "settings" && <SettingsView />}
					</main>
				</div>
				{showPermissionDialog && (
					<PermissionDialog onDismiss={() => setShowPermissionDialog(false)} />
				)}
				<CommandPalette
					open={commandPaletteOpen}
					onOpenChange={setCommandPaletteOpen}
				/>
				<EndOfDayFlow />
				<EventPreviewModal
					event={previewEvent}
					onClose={() => setPreviewEvent(null)}
				/>
			</div>
		</TooltipProvider>
	);
}
