import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { primaryImagePath } from "./EndOfDayFlow.utils";

type EventPickerFilter = "all" | "progress" | "risk";

interface EventPickerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	events: Event[];
	progressEvents: Event[];
	riskEvents: Event[];
	filter: EventPickerFilter;
	onFilterChange: (filter: EventPickerFilter) => void;
	onSelectEvent: (eventId: string) => void;
}

export function EventPickerDialog({
	open,
	onOpenChange,
	events,
	progressEvents,
	riskEvents,
	filter,
	onFilterChange,
	onSelectEvent,
}: EventPickerDialogProps) {
	const candidates = (() => {
		const base =
			filter === "risk"
				? riskEvents
				: filter === "progress"
					? progressEvents
					: events;
		return base.slice().sort((a, b) => b.timestamp - a.timestamp);
	})();

	const handleSelect = (eventId: string) => {
		onSelectEvent(eventId);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl">
				<DialogHeader>
					<DialogTitle>Insert event</DialogTitle>
					<DialogDescription>
						Pick a screenshot to embed in your journal entry.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant={filter === "all" ? "secondary" : "outline"}
						onClick={() => onFilterChange("all")}
					>
						All
					</Button>
					<Button
						size="sm"
						variant={filter === "progress" ? "secondary" : "outline"}
						onClick={() => onFilterChange("progress")}
					>
						Progress
					</Button>
					<Button
						size="sm"
						variant={filter === "risk" ? "secondary" : "outline"}
						onClick={() => onFilterChange("risk")}
					>
						Risk
					</Button>
				</div>

				<div className="max-h-[55vh] overflow-y-auto pr-1">
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{candidates.map((e) => {
							const img = primaryImagePath(e);
							return (
								<button
									key={e.id}
									type="button"
									className="w-full rounded-lg border border-border overflow-hidden text-left bg-background/30 transition-colors hover:border-primary/60 hover:ring-1 hover:ring-primary/40"
									onClick={() => handleSelect(e.id)}
								>
									<div className="relative w-full aspect-video bg-muted/30">
										{img ? (
											<img
												alt=""
												src={`local-file://${img}`}
												className="absolute inset-0 w-full h-full object-cover"
												loading="lazy"
											/>
										) : (
											<div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
												No image
											</div>
										)}
									</div>
									<div className="p-2">
										<div className="text-[11px] text-muted-foreground">
											{formatTime(e.timestamp)}
										</div>
										<div className="text-xs text-foreground/90 truncate">
											{e.caption ?? e.appName ?? "—"}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
