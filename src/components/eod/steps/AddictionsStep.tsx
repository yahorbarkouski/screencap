import { ArrowRight, ShieldCheck } from "lucide-react";
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
	if (riskMinutes === 0) {
		return (
			<>
				<FadeIn delay={0.02}>
					<div className="text-center space-y-2 mb-6">
						<h1 className="text-2xl font-bold">Addictions check-in</h1>
					</div>
				</FadeIn>

				<FadeIn delay={0.04}>
					<div className="flex flex-col items-center justify-center min-h-[300px] text-center">
						<div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4 ring-1 ring-green-500/20">
							<ShieldCheck
								className="w-8 h-8 text-green-500"
								strokeWidth={1.5}
							/>
						</div>
						<h3 className="text-lg font-medium">Clean day</h3>
						<p className="text-sm text-muted-foreground mt-1 max-w-xs">
							No addiction incidents detected today.
						</p>
					</div>
				</FadeIn>
			</>
		);
	}

	return (
		<>
			<FadeIn delay={0.02}>
				<div className="text-center space-y-2 mb-6">
					<h1 className="text-2xl font-bold">Addictions check-in</h1>
				</div>
			</FadeIn>

			<FadeIn delay={0.04}>
				{riskMinutes < 30 ? (
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
