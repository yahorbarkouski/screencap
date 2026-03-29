import { ChevronLeft, ChevronRight } from "lucide-react";
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
	totalPages?: number;
}

interface TimelineGroupHeaderProps {
	date: string;
	showPagination?: boolean;
	hasNextPage?: boolean;
	totalPages?: number;
}

interface TimelineEventRowProps {
	events: Event[];
	showProject?: boolean;
	columns?: number;
}

export function TimelineGroupHeader({
	date,
	showPagination = false,
	hasNextPage = false,
	totalPages = 1,
}: TimelineGroupHeaderProps) {
	const pagination = useAppStore((s) => s.pagination);
	const setPagination = useAppStore((s) => s.setPagination);

	return (
		<div className="flex items-center justify-between">
			<h3 className="text-sm font-medium text-muted-foreground">{date}</h3>
			{showPagination && (
				<div className="flex items-center gap-1 text-xs text-muted-foreground">
					<span>
						Page {pagination.page + 1} of {totalPages}
					</span>
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
	);
}

export function TimelineEventRow({
	events,
	showProject = false,
	columns,
}: TimelineEventRowProps) {
	const style = columns
		? {
				gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
			}
		: undefined;

	return (
		<div
			className={
				columns
					? "grid gap-4"
					: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
			}
			style={style}
		>
			{events.map((event) => (
				<EventCard key={event.id} event={event} showProject={showProject} />
			))}
		</div>
	);
}

export function TimelineGroup({
	date,
	events,
	showProject = false,
	showPagination = false,
	hasNextPage = false,
	totalPages = 1,
}: TimelineGroupProps) {
	return (
		<div>
			<div className="mb-4">
				<TimelineGroupHeader
					date={date}
					showPagination={showPagination}
					hasNextPage={hasNextPage}
					totalPages={totalPages}
				/>
			</div>
			<TimelineEventRow events={events} showProject={showProject} />
		</div>
	);
}
