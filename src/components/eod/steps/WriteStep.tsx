import { Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EodContent, EodSection, Event } from "@/types";
import { FadeIn } from "../EndOfDayFlow.primitives";
import { removeSection, upsertSection } from "../EndOfDayFlow.utils";
import { EventThumbnail } from "../EventCard";

interface WriteStepProps {
	content: EodContent;
	selectedSection: EodSection | null;
	events: Event[];
	isGenerating: boolean;
	canGenerateSummary: boolean;
	onGenerateSummary: () => void;
	onSelectSection: (id: string) => void;
	onAddSection: () => void;
	onOpenAttachDialog: (sectionId: string) => void;
	onUpdateContent: (updater: (prev: EodContent) => EodContent) => void;
}

export function WriteStep({
	content,
	selectedSection,
	events,
	isGenerating,
	canGenerateSummary,
	onGenerateSummary,
	onSelectSection,
	onAddSection,
	onOpenAttachDialog,
	onUpdateContent,
}: WriteStepProps) {
	const handleTitleChange = (nextTitle: string) => {
		if (!selectedSection) return;
		onUpdateContent((prev) => ({
			...prev,
			sections: upsertSection(prev.sections, selectedSection.id, (s) => ({
				...s,
				title: nextTitle,
			})),
		}));
	};

	const handleBodyChange = (nextBody: string) => {
		if (!selectedSection) return;
		onUpdateContent((prev) => ({
			...prev,
			sections: upsertSection(prev.sections, selectedSection.id, (s) => ({
				...s,
				body: nextBody,
			})),
		}));
	};

	const handleDeleteSection = () => {
		if (!selectedSection) return;
		onUpdateContent((prev) => ({
			...prev,
			sections: removeSection(prev.sections, selectedSection.id),
		}));
	};

	const handleRemoveAttachment = (eventId: string) => {
		if (!selectedSection) return;
		onUpdateContent((prev) => ({
			...prev,
			sections: upsertSection(prev.sections, selectedSection.id, (s) => ({
				...s,
				attachments: s.attachments.filter(
					(a) => !(a.kind === "event" && a.eventId === eventId),
				),
			})),
		}));
	};

	return (
		<>
			<FadeIn delay={0.02}>
				<div className="flex items-center justify-between mb-4 mr-32">
					<h1 className="text-2xl font-bold">Write</h1>
					<Button
						variant="outline"
						size="sm"
						onClick={onGenerateSummary}
						disabled={!canGenerateSummary || isGenerating}
					>
						{isGenerating ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : null}
						Generate Summary
					</Button>
				</div>
			</FadeIn>

			<FadeIn delay={0.04}>
				<div className="grid grid-cols-1 lg:grid-cols-[240px,minmax(0,1fr)] gap-6 h-[500px]">
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
											onClick={() => onOpenAttachDialog(selectedSection.id)}
											className="h-8 w-8 text-muted-foreground"
										>
											<Paperclip className="h-4 w-4" />
										</Button>
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
								<Textarea
									key={selectedSection.id}
									value={selectedSection.body}
									onChange={(e) => handleBodyChange(e.target.value)}
									placeholder="Write something..."
									className="min-h-[200px] resize-none border-none bg-transparent shadow-none p-4 text-base leading-relaxed focus-visible:ring-0"
								/>
								{selectedSection.attachments.length > 0 ? (
									<div className="p-4 pt-0 grid grid-cols-3 sm:grid-cols-4 gap-2">
										{selectedSection.attachments
											.filter(
												(a): a is Extract<typeof a, { kind: "event" }> =>
													a.kind === "event",
											)
											.map((a) => {
												const ev =
													events.find((e) => e.id === a.eventId) ?? null;
												return (
													<EventThumbnail
														key={a.eventId}
														event={ev}
														onRemove={() => handleRemoveAttachment(a.eventId)}
													/>
												);
											})}
									</div>
								) : null}
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
