import { Briefcase, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemories } from "@/hooks/useMemories";
import { useProjectStats } from "@/hooks/useProjectStats";
import { useAppStore } from "@/stores/app";
import type { Memory } from "@/types";
import { AddMemoryDialog } from "./AddMemoryDialog";
import { CollectionEmptyState } from "./CollectionEmptyState";
import { ProjectCard } from "./ProjectCard";
import { ProjectDetailView } from "./ProjectDetailView.tsx";

export function ProjectsView() {
	const { projects, createMemory, editMemory, deleteMemory } = useMemories();
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);

	const projectNames = useMemo(
		() => projects.map((p) => p.content),
		[projects],
	);
	const { stats } = useProjectStats(projectNames);

	const selectedProject = useMemo(() => {
		if (!selectedProjectId) return null;
		return projects.find((p) => p.id === selectedProjectId) ?? null;
	}, [projects, selectedProjectId]);

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
				onBack={handleBack}
				onEdit={handleEdit}
				onDelete={deleteMemory}
			/>
		);
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
					{projects.length === 0 ? (
						<CollectionEmptyState
							icon={<Briefcase className="size-6" />}
							title="Create your first project"
							description="Projects group your captures and let you link git repos for activity."
							hint='Example: "Screencap", "Thesis", "Client: ACME"'
							actionLabel="Track a project"
							onAction={() => setAddDialogOpen(true)}
						/>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
							{projects.map((project) => (
								<ProjectCard
									key={project.id}
									project={project}
									stats={stats[project.content]}
									onClick={() => handleProjectClick(project)}
								/>
							))}
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
