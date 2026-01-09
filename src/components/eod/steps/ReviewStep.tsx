import { formatTime } from "@/lib/utils";
import type { EodBlock, EodContentV2, Event } from "@/types";
import { FadeIn } from "../EndOfDayFlow.primitives";
import { primaryImagePath } from "../EndOfDayFlow.utils";

interface ReviewStepProps {
	content: EodContentV2;
	events: Event[];
	submittedAt: number | null;
}

export function ReviewStep({ content, events, submittedAt }: ReviewStepProps) {
	return (
		<>
			<FadeIn delay={0.02}>
				<div className="text-center space-y-2 mb-8">
					<h1 className="text-2xl font-bold">Review</h1>
					<p className="text-sm text-muted-foreground">
						{submittedAt
							? "Already submitted. Updates will be saved."
							: "Ready to wrap up the day?"}
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.04}>
				<div className="space-y-8 max-w-3xl mx-auto">
					{content.sections.map((s) => {
						const sectionHasContent = s.blocks.some((b) => {
							if (b.kind === "text") return b.content.trim().length > 0;
							return true;
						});

						return (
							<div key={s.id} className="space-y-3">
								<h2 className="text-lg font-semibold tracking-tight border-b border-border/50 pb-2">
									{s.title}
								</h2>
								{sectionHasContent ? (
									<div className="space-y-3">
										{s.blocks.map((block) => (
											<ReviewBlock
												key={block.id}
												block={block}
												events={events}
											/>
										))}
									</div>
								) : (
									<div className="text-muted-foreground italic text-sm">
										Empty
									</div>
								)}
							</div>
						);
					})}
				</div>
			</FadeIn>
		</>
	);
}

interface ReviewBlockProps {
	block: EodBlock;
	events: Event[];
}

function ReviewBlock({ block, events }: ReviewBlockProps) {
	if (block.kind === "text") {
		if (!block.content.trim()) return null;
		return (
			<div className="text-foreground/90 leading-relaxed text-sm whitespace-pre-wrap">
				{block.content}
			</div>
		);
	}

	const event = events.find((e) => e.id === block.eventId) ?? null;
	const img = event ? primaryImagePath(event) : null;

	return (
		<div className="flex items-start gap-3 p-2 rounded-lg border border-border/50 bg-muted/10">
			<div className="w-28 shrink-0 aspect-video rounded-md overflow-hidden bg-muted/30">
				{img ? (
					<img
						alt=""
						src={`local-file://${img}`}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
						No image
					</div>
				)}
			</div>
			<div className="flex-1 min-w-0 py-0.5">
				<div className="text-xs text-muted-foreground">
					{event ? formatTime(event.timestamp) : "Unknown"}
				</div>
				<div className="text-sm font-medium truncate">
					{event?.caption ?? event?.appName ?? "—"}
				</div>
				{event?.project && (
					<div className="text-xs text-muted-foreground truncate">
						{event.project}
					</div>
				)}
			</div>
		</div>
	);
}
