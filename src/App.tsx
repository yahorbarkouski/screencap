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
import { ProjectProgressView } from "@/components/progress/ProjectProgressView";
import { SettingsView } from "@/components/settings/SettingsView";
import { StoryView } from "@/components/story/StoryView";
import { Timeline } from "@/components/timeline/Timeline";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMemories } from "@/hooks/useMemories";
import { usePermission } from "@/hooks/usePermission";
import { useSettings } from "@/hooks/useSettings";
import { useAppStore } from "@/stores/app";

const ONBOARDING_VERSION = 1;

export default function App() {
	const view = useAppStore((s) => s.view);
	const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
	const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
	const openEod = useAppStore((s) => s.openEod);
	const settingsLoaded = useAppStore((s) => s.settingsLoaded);
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
					: new Date(new Date().setHours(0, 0, 0, 0)).getTime();
			openEod(dayStart);
		});
	}, [openEod]);

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
			</div>
		</TooltipProvider>
	);
}
