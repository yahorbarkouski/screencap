import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Command } from "cmdk";
import {
	BookOpen,
	Bot,
	Briefcase,
	Camera,
	Clock,
	Database,
	Flame,
	ImageIcon,
	Settings,
	SlidersHorizontal,
	Tag,
	Trash2,
	TrendingUp,
	Users,
	Workflow,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/stores/app";
import type { Memory, SettingsTab, View } from "@/types";

interface CommandPaletteProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const groupClassName = "text-xs text-muted-foreground px-2 py-1.5 space-y-2";
const itemClassName =
	"flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm text-foreground hover:bg-muted data-[selected=true]:bg-muted";

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
	const memories = useAppStore((s) => s.memories);
	const setView = useAppStore((s) => s.setView);
	const setSettingsTab = useAppStore((s) => s.setSettingsTab);
	const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
	const setFocusedAddictionId = useAppStore((s) => s.setFocusedAddictionId);
	const selectedEventIds = useAppStore((s) => s.selectedEventIds);
	const clearSelection = useAppStore((s) => s.clearSelection);

	const projects = useMemo(
		() =>
			memories
				.filter((m): m is Memory & { type: "project" } => m.type === "project")
				.sort((a, b) =>
					a.content.localeCompare(b.content, undefined, {
						sensitivity: "base",
					}),
				),
		[memories],
	);

	const addictions = useMemo(
		() =>
			memories
				.filter(
					(m): m is Memory & { type: "addiction" } => m.type === "addiction",
				)
				.sort((a, b) =>
					a.content.localeCompare(b.content, undefined, {
						sensitivity: "base",
					}),
				),
		[memories],
	);

	const close = useCallback(() => onOpenChange(false), [onOpenChange]);

	const navigateToView = useCallback(
		(view: View) => {
			setView(view);
			if (view === "projects") setSelectedProjectId(null);
			if (view === "addictions") setFocusedAddictionId(null);
			close();
		},
		[close, setFocusedAddictionId, setSelectedProjectId, setView],
	);

	const navigateToSettingsTab = useCallback(
		(tab: SettingsTab) => {
			setSettingsTab(tab);
			setView("settings");
			close();
		},
		[close, setSettingsTab, setView],
	);

	const navigateToProject = useCallback(
		(projectId: string) => {
			setSelectedProjectId(projectId);
			setView("projects");
			close();
		},
		[close, setSelectedProjectId, setView],
	);

	const navigateToAddiction = useCallback(
		(addictionId: string) => {
			setFocusedAddictionId(addictionId);
			setView("addictions");
			close();
		},
		[close, setFocusedAddictionId, setView],
	);

	const navigateToPlayground = useCallback(() => {
		window.location.hash = "#social-playground";
		close();
	}, [close]);

	const handleDismissSelected = async () => {
		if (selectedEventIds.size > 0) {
			await window.api.storage.dismissEvents(Array.from(selectedEventIds));
			clearSelection();
		}
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="p-0 max-w-lg overflow-hidden border-border"
				aria-describedby={undefined}
			>
				<VisuallyHidden.Root>
					<DialogTitle>Command Palette</DialogTitle>
				</VisuallyHidden.Root>
				<Command className="bg-card rounded-lg">
					<Command.Input
						placeholder="Type a command or search..."
						className="w-full h-12 px-4 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
					/>
					<Command.List className="max-h-80 overflow-y-auto p-2">
						<Command.Empty className="text-center text-sm text-muted-foreground py-6">
							No results found.
						</Command.Empty>

						<Command.Group heading="Navigation" className={groupClassName}>
							<Command.Item
								value="go timeline"
								className={itemClassName}
								onSelect={() => navigateToView("timeline")}
							>
								<Clock className="h-4 w-4" />
								Go to Timeline
							</Command.Item>
							<Command.Item
								value="go progress"
								className={itemClassName}
								onSelect={() => navigateToView("progress")}
							>
								<TrendingUp className="h-4 w-4" />
								Go to Progress
							</Command.Item>
							<Command.Item
								value="go journal"
								className={itemClassName}
								onSelect={() => navigateToView("story")}
							>
								<BookOpen className="h-4 w-4" />
								Go to Journal
							</Command.Item>
							<Command.Item
								value="go projects"
								className={itemClassName}
								onSelect={() => navigateToView("projects")}
							>
								<Briefcase className="h-4 w-4" />
								Go to Projects
							</Command.Item>
							<Command.Item
								value="go addictions"
								className={itemClassName}
								onSelect={() => navigateToView("addictions")}
							>
								<Flame className="h-4 w-4" />
								Go to Addictions
							</Command.Item>
							<Command.Item
								value="go settings"
								className={itemClassName}
								onSelect={() => navigateToView("settings")}
							>
								<Settings className="h-4 w-4" />
								Go to Settings
							</Command.Item>
							<Command.Item
								value="go playground social share"
								className={itemClassName}
								onSelect={navigateToPlayground}
							>
								<ImageIcon className="h-4 w-4" />
								Open Social Share Playground
							</Command.Item>
						</Command.Group>

						<Command.Group heading="Settings" className={groupClassName}>
							<Command.Item
								value="settings capture"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("capture")}
							>
								<Camera className="h-4 w-4" />
								Capture
							</Command.Item>
							<Command.Item
								value="settings ai"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("ai")}
							>
								<Bot className="h-4 w-4" />
								AI
							</Command.Item>
							<Command.Item
								value="settings automation"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("automation")}
							>
								<Workflow className="h-4 w-4" />
								Automation
							</Command.Item>
							<Command.Item
								value="settings data"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("data")}
							>
								<Database className="h-4 w-4" />
								Data
							</Command.Item>
							<Command.Item
								value="settings social"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("social")}
							>
								<Users className="h-4 w-4" />
								Social
							</Command.Item>
							<Command.Item
								value="settings system"
								className={itemClassName}
								onSelect={() => navigateToSettingsTab("system")}
							>
								<SlidersHorizontal className="h-4 w-4" />
								System
							</Command.Item>
						</Command.Group>

						{projects.length > 0 && (
							<Command.Group heading="Projects" className={groupClassName}>
								{projects.map((project) => (
									<Command.Item
										key={project.id}
										value={`project ${project.content}`}
										className={itemClassName}
										onSelect={() => navigateToProject(project.id)}
									>
										<Briefcase className="h-4 w-4" />
										{project.content}
									</Command.Item>
								))}
							</Command.Group>
						)}

						{addictions.length > 0 && (
							<Command.Group heading="Addictions" className={groupClassName}>
								{addictions.map((addiction) => (
									<Command.Item
										key={addiction.id}
										value={`addiction ${addiction.content}`}
										className={itemClassName}
										onSelect={() => navigateToAddiction(addiction.id)}
									>
										<Flame className="h-4 w-4" />
										{addiction.content}
									</Command.Item>
								))}
							</Command.Group>
						)}

						{selectedEventIds.size > 0 && (
							<Command.Group heading="Actions" className={groupClassName}>
								<Command.Item
									value="dismiss selected"
									className={itemClassName}
									onSelect={handleDismissSelected}
								>
									<Trash2 className="h-4 w-4" />
									Dismiss {selectedEventIds.size} selected
								</Command.Item>
								<Command.Item
									value="relabel selected"
									className={itemClassName}
									onSelect={close}
								>
									<Tag className="h-4 w-4" />
									Relabel {selectedEventIds.size} selected
								</Command.Item>
							</Command.Group>
						)}
					</Command.List>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
