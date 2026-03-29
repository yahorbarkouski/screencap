import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEvents } from "@/hooks/useEvents";
import { groupEventsByDate } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import type { Event } from "@/types";
import { BulkActions } from "./BulkActions";
import { TimelineFilters } from "./TimelineFilters";
import { TimelineEventRow, TimelineGroupHeader } from "./TimelineGroup";
import { useResponsiveColumns } from "./useResponsiveColumns";
import {
	buildVirtualTimelineItems,
	estimateVirtualTimelineItemSize,
} from "./virtualTimeline";

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
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const columns = useResponsiveColumns(contentRef);

	const entries = useMemo(() => Array.from(groups.entries()), [groups]);
	const items = useMemo(
		() => buildVirtualTimelineItems(entries, columns),
		[entries, columns],
	);

	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => viewportRef.current,
		estimateSize: (index) => estimateVirtualTimelineItemSize(items[index]),
		overscan: 3,
	});

	if (groups.size === 0) {
		return (
			<div className="p-6 text-center py-12">
				<p className="text-muted-foreground">
					No events yet. Screenshots will appear here once captured.
				</p>
			</div>
		);
	}

	return (
		<ScrollArea className="flex-1" stableGutter viewportRef={viewportRef}>
			<div ref={contentRef} className="p-6">
				<div
					className="relative w-full"
					style={{ height: `${virtualizer.getTotalSize()}px` }}
				>
					{virtualizer.getVirtualItems().map((virtualItem) => {
						const item = items[virtualItem.index];
						if (!item) return null;

						return (
							<div
								key={item.key}
								ref={virtualizer.measureElement}
								data-index={virtualItem.index}
								className="absolute left-0 top-0 w-full"
								style={{ transform: `translateY(${virtualItem.start}px)` }}
							>
								<div style={{ paddingBottom: `${item.spacingAfter}px` }}>
									{item.type === "header" ? (
										<TimelineGroupHeader
											date={item.date}
											showPagination={item.showPagination}
											hasNextPage={hasNextPage}
											totalPages={totalPages}
										/>
									) : (
										<TimelineEventRow events={item.events} columns={columns} />
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</ScrollArea>
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

			{isLoading && events.length === 0 ? (
				<div className="flex-1 flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</div>
			) : (
				<TimelineList
					groups={groupedEvents}
					hasNextPage={hasNextPage}
					totalPages={totalPages}
				/>
			)}
		</div>
	);
}
