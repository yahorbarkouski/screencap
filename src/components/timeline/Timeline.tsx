import { Loader2 } from "lucide-react";
import { memo, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEvents } from "@/hooks/useEvents";
import { groupEventsByDate } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { Event } from "@/types";
import { BulkActions } from "./BulkActions";
import { TimelineFilters } from "./TimelineFilters";
import { TimelineGroup } from "./TimelineGroup";

const SelectedBulkActions = memo(function SelectedBulkActions() {
	const selectedCount = useAppStore((s) => s.selectedEventIds.size);
	if (selectedCount === 0) return null;
	return <BulkActions />;
});

const TimelineList = memo(function TimelineList({
	groups,
	hasNextPage,
	totalPages,
}: {
	groups: Map<string, Event[]>;
	hasNextPage: boolean;
	totalPages: number;
}) {
	if (groups.size === 0) {
		return (
			<div className="text-center py-12">
				<p className="text-muted-foreground">
					No events yet. Screenshots will appear here once captured.
				</p>
			</div>
		);
	}

	const entries = Array.from(groups.entries());

	return (
		<>
			{entries.map(([date, dateEvents], index) => (
				<TimelineGroup
					key={date}
					date={date}
					events={dateEvents}
					showPagination={index === 0}
					hasNextPage={hasNextPage}
					totalPages={totalPages}
				/>
			))}
		</>
	);
});

export function Timeline() {
	const { events, hasNextPage, totalPages, isLoading } = useEvents();
	const groupedEvents = useMemo(() => {
		return groupEventsByDate(events);
	}, [events]);

	return (
		<div className="h-full flex flex-col">
			<TimelineFilters />

			<SelectedBulkActions />

			<ScrollArea className="flex-1" stableGutter>
				<div className="p-6 space-y-8">
					{isLoading && events.length === 0 ? (
						<div className="h-full flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : (
						<TimelineList groups={groupedEvents} hasNextPage={hasNextPage} totalPages={totalPages} />
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
