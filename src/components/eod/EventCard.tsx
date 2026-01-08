import { X } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { primaryImagePath } from "./EndOfDayFlow.utils";

interface EventCardProps {
	event: Event;
	selected?: boolean;
	onToggle?: () => void;
	onRemove?: () => void;
	showProject?: boolean;
	showAddiction?: boolean;
	disabled?: boolean;
}

export function EventCard({
	event,
	selected,
	onToggle,
	onRemove,
	showProject,
	showAddiction,
	disabled,
}: EventCardProps) {
	const img = primaryImagePath(event);
	const isInteractive = !!onToggle;

	const content = (
		<>
			<div className="aspect-video bg-muted/30 flex items-center justify-center">
				{img ? (
					<img
						alt=""
						src={`local-file://${img}`}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : null}
			</div>
			<div className="p-2">
				<div className="text-[10px] text-muted-foreground">
					{formatTime(event.timestamp)}
				</div>
				<div className="truncate text-xs font-medium">
					{showAddiction
						? event.trackedAddiction
						: (event.caption ?? event.appName ?? "—")}
				</div>
				{showProject && event.project && (
					<div className="truncate text-[10px] text-muted-foreground">
						{event.project}
					</div>
				)}
			</div>
			{selected && (
				<div className="absolute top-1 right-1 h-4 w-4 bg-primary rounded-full flex items-center justify-center shadow-sm">
					<div className="h-1.5 w-1.5 bg-primary-foreground rounded-full" />
				</div>
			)}
			{onRemove && (
				<button
					type="button"
					className="absolute top-1 right-1 h-5 w-5 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
				>
					<X className="h-3 w-3" />
				</button>
			)}
		</>
	);

	if (isInteractive) {
		return (
			<button
				type="button"
				disabled={disabled}
				className={cn(
					"rounded-lg border overflow-hidden text-left bg-background/30 transition-colors relative group",
					selected
						? "border-primary ring-1 ring-primary"
						: "border-border hover:border-primary/40",
				)}
				onClick={onToggle}
			>
				{content}
			</button>
		);
	}

	return (
		<div
			className={cn(
				"rounded-lg border overflow-hidden bg-background/20 relative group",
				disabled ? "opacity-60 border-border/50" : "border-border",
			)}
		>
			{content}
		</div>
	);
}

interface EventThumbnailProps {
	event: Event | null;
	onRemove?: () => void;
}

export function EventThumbnail({ event, onRemove }: EventThumbnailProps) {
	const img = event ? primaryImagePath(event) : null;

	return (
		<div className="relative rounded-md border border-border bg-background/40 overflow-hidden group aspect-video">
			{img ? (
				<img
					alt=""
					src={`local-file://${img}`}
					className="w-full h-full object-cover"
					loading="lazy"
				/>
			) : null}
			{onRemove && (
				<button
					type="button"
					className="absolute top-1 right-1 h-5 w-5 rounded bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
					onClick={onRemove}
				>
					<X className="h-3 w-3" />
				</button>
			)}
		</div>
	);
}
