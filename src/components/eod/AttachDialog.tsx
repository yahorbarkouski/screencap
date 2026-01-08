import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { primaryImagePath } from "./EndOfDayFlow.utils";

type AttachFilter = "all" | "progress" | "risk";

interface AttachDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	events: Event[];
	progressEvents: Event[];
	riskEvents: Event[];
	filter: AttachFilter;
	onFilterChange: (filter: AttachFilter) => void;
	selection: Set<string>;
	onToggleSelection: (id: string) => void;
	onApply: () => void;
}

export function AttachDialog({
	open,
	onOpenChange,
	events,
	progressEvents,
	riskEvents,
	filter,
	onFilterChange,
	selection,
	onToggleSelection,
	onApply,
}: AttachDialogProps) {
	const candidates = (() => {
		const base =
			filter === "risk"
				? riskEvents
				: filter === "progress"
					? progressEvents
					: events;
		return base.slice().sort((a, b) => b.timestamp - a.timestamp);
	})();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl">
				<DialogHeader>
					<DialogTitle>Attach events</DialogTitle>
					<DialogDescription>
						Pick screenshots from today to attach to the current section.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center justify-between gap-3">
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
					<div className="text-xs text-muted-foreground">
						{selection.size} selected
					</div>
				</div>

				<div className="max-h-[55vh] overflow-y-auto pr-1">
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{candidates.slice(0, 72).map((e) => {
							const img = primaryImagePath(e);
							const selected = selection.has(e.id);
							return (
								<button
									key={e.id}
									type="button"
									className={cn(
										"w-full rounded-lg border overflow-hidden text-left bg-background/30 transition-colors relative group",
										selected
											? "border-primary ring-1 ring-primary"
											: "border-border hover:border-primary/40",
									)}
									onClick={() => onToggleSelection(e.id)}
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
									{selected && (
										<div className="absolute top-1 right-1 h-4 w-4 bg-primary rounded-full flex items-center justify-center shadow-sm">
											<div className="h-1.5 w-1.5 bg-primary-foreground rounded-full" />
										</div>
									)}
								</button>
							);
						})}
					</div>
				</div>

				<DialogFooter className="mt-2">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={onApply}>Attach</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
