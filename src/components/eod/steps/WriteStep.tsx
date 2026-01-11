import { Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { EodContentV2, EodSection, Event } from "@/types";
import { BlockEditor } from "../BlockEditor";
import { FadeIn } from "../EndOfDayFlow.primitives";
import { removeSection, upsertSection } from "../EndOfDayFlow.utils";

interface WriteStepProps {
	content: EodContentV2;
	selectedSection: EodSection | null;
	events: Event[];
	onSelectSection: (id: string) => void;
	onAddSection: () => void;
	onOpenEventPicker: (sectionId: string, insertAfterBlockId: string) => void;
	onUpdateContent: (updater: (prev: EodContentV2) => EodContentV2) => void;
}

export function WriteStep({
	content,
	selectedSection,
	events,
	onSelectSection,
	onAddSection,
	onOpenEventPicker,
	onUpdateContent,
}: WriteStepProps) {
	const [sectionToDelete, setSectionToDelete] = useState<EodSection | null>(
		null,
	);

	const handleTitleChange = useCallback(
		(nextTitle: string) => {
			if (!selectedSection) return;
			onUpdateContent((prev) => ({
				...prev,
				sections: upsertSection(prev.sections, selectedSection.id, (s) => ({
					...s,
					title: nextTitle,
				})),
			}));
		},
		[selectedSection, onUpdateContent],
	);

	const handleDeleteSection = useCallback(
		(section: EodSection) => {
			const currentIndex = content.sections.findIndex(
				(s) => s.id === section.id,
			);
			const prevSection = content.sections[currentIndex - 1];
			const nextSection = content.sections[currentIndex + 1];
			const targetSection = prevSection ?? nextSection;

			onUpdateContent((prev) => ({
				...prev,
				sections: removeSection(prev.sections, section.id),
			}));

			if (targetSection) {
				onSelectSection(targetSection.id);
			}

			setSectionToDelete(null);
		},
		[content.sections, onUpdateContent, onSelectSection],
	);

	const handleUpdateSection = useCallback(
		(updatedSection: EodSection) => {
			onUpdateContent((prev) => ({
				...prev,
				sections: upsertSection(
					prev.sections,
					updatedSection.id,
					() => updatedSection,
				),
			}));
		},
		[onUpdateContent],
	);

	const handleOpenEventPicker = useCallback(
		(insertAfterBlockId: string) => {
			if (!selectedSection) return;
			onOpenEventPicker(selectedSection.id, insertAfterBlockId);
		},
		[selectedSection, onOpenEventPicker],
	);

	return (
		<>
			<FadeIn delay={0.02}>
				<h1 className="text-2xl font-bold text-center w-full">Thoughts</h1>
			</FadeIn>

			<FadeIn delay={0.04}>
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr),240px] gap-6 h-fit min-h-[600px] pb-64">
					<div className="flex flex-col h-full overflow-hidden pl-4">
						{selectedSection ? (
							<div className="flex flex-col h-full">
								<div className="py-3 pl-14">
									<Input
										value={selectedSection.title}
										onChange={(e) => handleTitleChange(e.target.value)}
										className="h-9 border-none bg-transparent shadow-none font-semibold text-lg px-0 focus-visible:ring-0"
										placeholder="Section title"
									/>
								</div>
								<ScrollArea className="flex-1">
									<BlockEditor
										section={selectedSection}
										events={events}
										onUpdateSection={handleUpdateSection}
										onOpenEventPicker={handleOpenEventPicker}
									/>
								</ScrollArea>
							</div>
						) : (
							<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
								Select a section to edit
							</div>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<div className="space-y-1 mt-3">
							{content.sections.map((s) => {
								const isSelected = selectedSection?.id === s.id;
								return (
									<div
										key={s.id}
										className={cn(
											"group flex items-center gap-1 rounded-lg transition-colors text-sm font-medium",
											isSelected
												? "bg-secondary text-secondary-foreground"
												: "hover:bg-muted/50 text-muted-foreground hover:text-foreground",
										)}
									>
										<button
											type="button"
											onClick={() => onSelectSection(s.id)}
											className="flex-1 text-left px-3 py-2 truncate"
										>
											{s.title.trim() ? s.title : "Untitled"}
										</button>
										{content.sections.length > 1 && (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													setSectionToDelete(s);
												}}
												className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										)}
									</div>
								);
							})}
						</div>
						<Button
							variant="ghost"
							size="sm"
							className="justify-start px-3 text-muted-foreground"
							onClick={onAddSection}
						>
							<Plus className="mr-2 h-3.5 w-3.5" />
							Add section
						</Button>
					</div>
				</div>
			</FadeIn>

			<Dialog
				open={sectionToDelete !== null}
				onOpenChange={(open) => !open && setSectionToDelete(null)}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Delete section</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "
							{sectionToDelete?.title.trim() || "Untitled"}"? This action cannot
							be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setSectionToDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() =>
								sectionToDelete && handleDeleteSection(sectionToDelete)
							}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
