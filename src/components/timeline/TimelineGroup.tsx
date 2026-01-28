import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app";
import type { Event } from "@/types";
import { EventCard } from "./EventCard";

interface TimelineGroupProps {
	date: string;
	events: Event[];
	showProject?: boolean;
	showPagination?: boolean;
	hasNextPage?: boolean;
}

export function TimelineGroup({
	date,
	events,
	showProject = false,
	showPagination = false,
	hasNextPage = false,
}: TimelineGroupProps) {
	const pagination = useAppStore((s) => s.pagination);
	const setPagination = useAppStore((s) => s.setPagination);
	const filters = useAppStore((s) => s.filters);
	const updateEvent = useAppStore((s) => s.updateEvent);
	const [confirming, setConfirming] = useState(false);

	const eventsNeedingReview = events.filter(
		(e) => e.addictionCandidate && !e.trackedAddiction,
	);

	const handleConfirmAll = useCallback(async () => {
		if (eventsNeedingReview.length === 0 || !window.api) return;
		setConfirming(true);
		try {
			const ids = eventsNeedingReview.map((e) => e.id);
			await window.api.storage.confirmAddiction(ids);
			for (const event of eventsNeedingReview) {
				updateEvent(event.id, { trackedAddiction: event.addictionCandidate });
			}
		} finally {
			setConfirming(false);
		}
	}, [eventsNeedingReview, updateEvent]);

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium text-muted-foreground">{date}</h3>
				<div className="flex items-center gap-2">
					{filters.needsAddictionReview &&
						eventsNeedingReview.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								className="h-6 gap-1.5 text-xs"
								disabled={confirming}
								onClick={handleConfirmAll}
							>
								<Check className="h-3 w-3" />
								{confirming
									? "Confirming..."
									: `Confirm all (${eventsNeedingReview.length})`}
							</Button>
						)}
					{showPagination && (
						<div className="flex items-center gap-1 text-xs text-muted-foreground">
							<span>{pagination.page + 1}</span>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6"
								disabled={pagination.page === 0}
								onClick={() =>
									setPagination({ page: Math.max(0, pagination.page - 1) })
								}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6"
								disabled={!hasNextPage}
								onClick={() => setPagination({ page: pagination.page + 1 })}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					)}
				</div>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{events.map((event) => (
					<EventCard key={event.id} event={event} showProject={showProject} />
				))}
			</div>
		</div>
	);
}
