import { Briefcase, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemories } from "@/hooks/useMemories";
import { useProjectStats } from "@/hooks/useProjectStats";
import { normalizeProjectName } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { Memory, SharedProject } from "@/types";
import { AddMemoryDialog } from "./AddMemoryDialog";
import { CollectionEmptyState } from "./CollectionEmptyState";
import { ProjectCard } from "./ProjectCard";
import { ProjectDetailView } from "./ProjectDetailView.tsx";

type EnrichedProject = {
	project: Memory;
	isShared: boolean;
	roomId?: string;
	sharedWith?: string;
};

type SharedOnlyProject = {
	roomId: string;
	projectName: string;
	ownerUsername: string;
};

export function ProjectsView() {
	const { projects, createMemory, editMemory, deleteMemory } = useMemories();
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
	const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);

	useEffect(() => {
		if (!window.api?.sharedProjects) return;
		void window.api.sharedProjects.list().then(setSharedProjects);
	}, []);

	const projectNames = useMemo(
		() => projects.map((p) => p.content),
		[projects],
	);
	const { stats } = useProjectStats(projectNames);

	const { enrichedProjects, sharedOnlyProjects } = useMemo(() => {
		const enriched: EnrichedProject[] = [];
		const sharedOnly: SharedOnlyProject[] = [];
		const seenNames = new Set<string>();

		for (const project of projects) {
			const normalizedName = normalizeProjectName(project.content);
			const shared = sharedProjects.find(
				(sp) => normalizeProjectName(sp.projectName) === normalizedName,
			);
			enriched.push({
				project,
				isShared: !!shared,
				roomId: shared?.roomId,
				sharedWith: shared?.ownerUsername,
			});
			seenNames.add(normalizedName);
		}

		for (const sp of sharedProjects) {
			const normalizedName = normalizeProjectName(sp.projectName);
			if (!seenNames.has(normalizedName) && !sp.isOwner) {
				sharedOnly.push({
					roomId: sp.roomId,
					projectName: sp.projectName,
					ownerUsername: sp.ownerUsername,
				});
			}
		}

		return { enrichedProjects: enriched, sharedOnlyProjects: sharedOnly };
	}, [projects, sharedProjects]);

	const selectedProject = useMemo(() => {
		if (!selectedProjectId) return null;
		return projects.find((p) => p.id === selectedProjectId) ?? null;
	}, [projects, selectedProjectId]);

	const selectedSharedProject = useMemo(() => {
		if (!selectedProjectId) return null;
		if (selectedProjectId.startsWith("shared:")) {
			const roomId = selectedProjectId.replace("shared:", "");
			return sharedProjects.find((sp) => sp.roomId === roomId) ?? null;
		}
		if (selectedProject) {
			const normalizedName = normalizeProjectName(selectedProject.content);
			return sharedProjects.find(
				(sp) => normalizeProjectName(sp.projectName) === normalizedName,
			) ?? null;
		}
		return null;
	}, [selectedProjectId, sharedProjects, selectedProject]);

	useEffect(() => {
		return () => setSelectedProjectId(null);
	}, [setSelectedProjectId]);

	const handleCreate = useCallback(
		async (data: { content: string; description?: string | null }) => {
			await createMemory("project", data.content, data.description);
			setAddDialogOpen(false);
		},
		[createMemory],
	);

	const handleProjectClick = useCallback(
		(project: Memory) => {
			setSelectedProjectId(project.id);
		},
		[setSelectedProjectId],
	);

	const handleSharedOnlyClick = useCallback(
		(roomId: string) => {
			setSelectedProjectId(`shared:${roomId}`);
		},
		[setSelectedProjectId],
	);

	const handleBack = useCallback(() => {
		setSelectedProjectId(null);
	}, [setSelectedProjectId]);

	const handleEdit = useCallback(
		async (
			id: string,
			updates: { content: string; description?: string | null },
		) => {
			await editMemory(id, updates);
		},
		[editMemory],
	);

	if (selectedProject) {
		return (
			<ProjectDetailView
				project={selectedProject}
				stats={stats[selectedProject.content]}
				sharedProject={selectedSharedProject}
				onBack={handleBack}
				onEdit={handleEdit}
				onDelete={deleteMemory}
			/>
		);
	}

	if (selectedProjectId?.startsWith("shared:")) {
		const roomId = selectedProjectId.replace("shared:", "");
		const sp = sharedProjects.find((p) => p.roomId === roomId);
		if (sp) {
			const syntheticProject: Memory = {
				id: `shared:${sp.roomId}`,
				type: "project",
				content: sp.projectName,
				description: `Shared by @${sp.ownerUsername}`,
				createdAt: sp.joinedAt,
				updatedAt: sp.joinedAt,
			};
			return (
				<ProjectDetailView
					project={syntheticProject}
					sharedProject={sp}
					onBack={handleBack}
					onEdit={async () => {}}
					onDelete={async () => {}}
					isSharedOnly
				/>
			);
		}
	}

	return (
		<div className="h-full flex flex-col">
			<div className="drag-region flex border-b border-border p-2 px-4 justify-between">
				<div className="flex flex-col">
					<h1 className="text-lg font-semibold">Projects</h1>
					<p className="text-sm text-muted-foreground">
						Define projects and link repos for code journals
					</p>
				</div>

				<div className="flex items-center gap-2 no-drag pt-2">
					<Button onClick={() => setAddDialogOpen(true)} size="sm">
						<Plus className="size-3.5" />
						Track new project
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div className="p-6 max-w-6xl mx-auto">
					{projects.length === 0 && sharedOnlyProjects.length === 0 ? (
						<CollectionEmptyState
							icon={<Briefcase className="size-6" />}
							title="Create your first project"
							description="Projects group your captures and let you link git repos for activity."
							hint='Example: "Screencap", "Thesis", "Client: ACME"'
							actionLabel="Track a project"
							onAction={() => setAddDialogOpen(true)}
						/>
					) : (
						<div className="space-y-8">
							{enrichedProjects.length > 0 && (
								<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
									{enrichedProjects.map(({ project, isShared, sharedWith }) => (
										<ProjectCard
											key={project.id}
											project={project}
											stats={stats[project.content]}
											isShared={isShared}
											sharedWith={sharedWith}
											onClick={() => handleProjectClick(project)}
										/>
									))}
								</div>
							)}

							{sharedOnlyProjects.length > 0 && (
								<div className="space-y-4">
									<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
										<Users className="h-4 w-4" />
										<span>Shared with me</span>
									</div>
									<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
										{sharedOnlyProjects.map((sp) => (
											<button
												key={sp.roomId}
												type="button"
												onClick={() => handleSharedOnlyClick(sp.roomId)}
												className="group text-left w-full h-full rounded-xl border border-border bg-card overflow-hidden transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col p-5"
											>
												<div className="flex items-center gap-2 mb-2">
													<Users className="h-4 w-4 text-primary" />
													<span className="text-xs text-primary font-medium">
														Shared
													</span>
												</div>
												<h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors line-clamp-1">
													{sp.projectName}
												</h3>
												<p className="mt-2 text-sm text-muted-foreground">
													Shared by @{sp.ownerUsername}
												</p>
											</button>
										))}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</ScrollArea>

			<AddMemoryDialog
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
				type="project"
				onSubmit={handleCreate}
			/>
		</div>
	);
}
