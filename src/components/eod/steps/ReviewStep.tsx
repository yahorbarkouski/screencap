import type { EodAttachment, EodContent, Event } from "@/types";
import { FadeIn } from "../EndOfDayFlow.primitives";
import { primaryImagePath } from "../EndOfDayFlow.utils";

interface ReviewStepProps {
	content: EodContent;
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
					{content.sections.map((s) => (
						<div key={s.id} className="space-y-3">
							<h2 className="text-lg font-semibold tracking-tight border-b border-border/50 pb-2">
								{s.title}
							</h2>
							{s.body.trim() ? (
								<div className="text-foreground/90 leading-relaxed text-sm whitespace-pre-wrap">
									{s.body}
								</div>
							) : (
								<div className="text-muted-foreground italic text-sm">
									Empty
								</div>
							)}
							{s.attachments.length > 0 && (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
									{s.attachments
										.filter(
											(a): a is Extract<EodAttachment, { kind: "event" }> =>
												a.kind === "event",
										)
										.map((a) => {
											const ev = events.find((e) => e.id === a.eventId) ?? null;
											const img = ev ? primaryImagePath(ev) : null;
											return (
												<div
													key={a.eventId}
													className="rounded-lg border border-border overflow-hidden aspect-video bg-muted/20"
												>
													{img ? (
														<img
															alt=""
															src={`local-file://${img}`}
															className="w-full h-full object-cover"
															loading="lazy"
														/>
													) : null}
												</div>
											);
										})}
								</div>
							)}
						</div>
					))}
				</div>
			</FadeIn>
		</>
	);
}
