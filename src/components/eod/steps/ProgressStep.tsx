import type { Event } from "@/types";
import { FadeIn, Stamp } from "../EndOfDayFlow.primitives";
import { EventCard } from "../EventCard";

interface ProgressStepProps {
	potentialProgressEvents: Event[];
	progressEvents: Event[];
	potentialProgressSelection: Set<string>;
	onToggleSelection: (id: string) => void;
}

export function ProgressStep({
	potentialProgressEvents,
	progressEvents,
	potentialProgressSelection,
	onToggleSelection,
}: ProgressStepProps) {
	return (
		<>
			<FadeIn delay={0.02}>
				<div className="text-center space-y-2 mb-6">
					<h1 className="text-2xl font-bold">Review progress</h1>
					<p className="text-sm text-muted-foreground">
						Select work sessions you'd like to mark as progress
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.04}>
				{potentialProgressEvents.length === 0 ? (
					<Stamp
						tone="neutral"
						title="No potential progress"
						detail="No work sessions detected for your projects today."
					/>
				) : (
					<>
						<div className="flex items-center justify-between mb-4">
							<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
								POTENTIAL PROGRESS ({potentialProgressEvents.length})
							</div>
							<div className="text-xs text-muted-foreground">
								{potentialProgressSelection.size} selected
							</div>
						</div>
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{potentialProgressEvents.slice(0, 16).map((e) => (
								<EventCard
									key={e.id}
									event={e}
									selected={potentialProgressSelection.has(e.id)}
									onToggle={() => onToggleSelection(e.id)}
									showProject
								/>
							))}
						</div>
					</>
				)}
			</FadeIn>

			{progressEvents.length > 0 && (
				<FadeIn delay={0.06} className="mt-8">
					<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground mb-3">
						CONFIRMED PROGRESS ({progressEvents.length})
					</div>
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 opacity-60">
						{progressEvents.slice(0, 8).map((e) => (
							<EventCard key={e.id} event={e} disabled />
						))}
					</div>
				</FadeIn>
			)}
		</>
	);
}
