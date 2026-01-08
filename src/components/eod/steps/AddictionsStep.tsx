import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type CountItem, CountList } from "@/components/wrapped/CountList";
import type { Event } from "@/types";
import { FadeIn, Stamp } from "../EndOfDayFlow.primitives";
import { formatMinutes } from "../EndOfDayFlow.utils";
import { EventCard } from "../EventCard";

interface AddictionsStepProps {
	riskMinutes: number;
	riskEvents: Event[];
	riskSelection: Set<string>;
	topRiskAddictions: CountItem[];
	topRiskSources: CountItem[];
	onToggleSelection: (id: string) => void;
	onCreateAddictionsSection: () => void;
}

export function AddictionsStep({
	riskMinutes,
	riskEvents,
	riskSelection,
	topRiskAddictions,
	topRiskSources,
	onToggleSelection,
	onCreateAddictionsSection,
}: AddictionsStepProps) {
	return (
		<>
			<FadeIn delay={0.02}>
				<div className="text-center space-y-2 mb-6">
					<h1 className="text-2xl font-bold">Addictions check-in</h1>
				</div>
			</FadeIn>

			<FadeIn delay={0.04}>
				{riskMinutes === 0 ? (
					<Stamp
						tone="good"
						title="Clean day"
						detail="No addiction incidents detected."
					/>
				) : riskMinutes < 30 ? (
					<Stamp
						tone="warn"
						title="Some risk"
						detail={`${formatMinutes(riskMinutes)} of risk time detected.`}
					/>
				) : (
					<Stamp
						tone="bad"
						title="High risk"
						detail={`${formatMinutes(riskMinutes)} of risk time detected.`}
					/>
				)}
			</FadeIn>

			<FadeIn delay={0.06}>
				<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
					<CountList title="Top addictions" items={topRiskAddictions} />
					<CountList title="Top sources" items={topRiskSources} />
				</div>
			</FadeIn>

			{riskEvents.length > 0 ? (
				<FadeIn delay={0.08} className="mt-6">
					<div className="flex items-center justify-between">
						<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
							EPISODES
						</div>
						<Button
							size="sm"
							variant="secondary"
							onClick={onCreateAddictionsSection}
						>
							Review in Journal
							<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
						</Button>
					</div>
					<div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
						{riskEvents
							.slice()
							.sort((a, b) => b.timestamp - a.timestamp)
							.slice(0, 8)
							.map((e) => (
								<EventCard
									key={e.id}
									event={e}
									selected={riskSelection.has(e.id)}
									onToggle={() => onToggleSelection(e.id)}
									showAddiction
								/>
							))}
					</div>
				</FadeIn>
			) : null}
		</>
	);
}
