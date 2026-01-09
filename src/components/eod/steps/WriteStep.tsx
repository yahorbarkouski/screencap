import { Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
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

	const handleDeleteSection = useCallback(() => {
		if (!selectedSection) return;

		const currentIndex = content.sections.findIndex(
			(s) => s.id === selectedSection.id,
		);
		const prevSection = content.sections[currentIndex - 1];
		const nextSection = content.sections[currentIndex + 1];
		const targetSection = prevSection ?? nextSection;

		onUpdateContent((prev) => ({
			...prev,
			sections: removeSection(prev.sections, selectedSection.id),
		}));

		if (targetSection) {
			onSelectSection(targetSection.id);

			if (prevSection) {
				const lastTextBlock = [...prevSection.blocks]
					.reverse()
					.find((b) => b.kind === "text");
				if (lastTextBlock) {
					requestAnimationFrame(() => {
						const textarea = document.querySelector(
							`[data-block-id="${lastTextBlock.id}"] textarea`,
						) as HTMLTextAreaElement | null;
						if (textarea) {
							textarea.focus();
							textarea.setSelectionRange(
								textarea.value.length,
								textarea.value.length,
							);
						}
					});
				}
			}
		}
	}, [selectedSection, content.sections, onUpdateContent, onSelectSection]);

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
				<h1 className="text-2xl font-bold mb-4 mr-32">Write</h1>
			</FadeIn>

			<FadeIn delay={0.04}>
				<div className="grid grid-cols-1 lg:grid-cols-[240px,minmax(0,1fr)] gap-6 h-fit min-h-[600px]">
					<div className="flex flex-col gap-2">
						<div className="space-y-1">
							{content.sections.map((s) => {
								const isSelected = selectedSection?.id === s.id;
								return (
									<button
										key={s.id}
										type="button"
										onClick={() => onSelectSection(s.id)}
										className={cn(
											"w-full text-left rounded-lg px-3 py-2 transition-colors text-sm font-medium",
											isSelected
												? "bg-secondary text-secondary-foreground"
												: "hover:bg-muted/50 text-muted-foreground hover:text-foreground",
										)}
									>
										<div className="truncate">
											{s.title.trim() ? s.title : "Untitled"}
										</div>
									</button>
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

					<div className="flex flex-col h-full bg-muted/10 rounded-xl border border-border/50 overflow-hidden">
						{selectedSection ? (
							<div className="flex flex-col h-full">
								<div className="flex items-center gap-2 p-3 border-b border-border/50">
									<Input
										value={selectedSection.title}
										onChange={(e) => handleTitleChange(e.target.value)}
										className="h-9 border-none bg-transparent shadow-none font-semibold text-lg px-2 focus-visible:ring-0"
										placeholder="Section title"
									/>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											onClick={handleDeleteSection}
											disabled={content.sections.length <= 1}
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
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
				</div>
			</FadeIn>
		</>
	);
}
