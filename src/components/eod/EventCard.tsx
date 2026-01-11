import { Check } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { Event } from "@/types";
import { primaryImagePath } from "./EndOfDayFlow.utils";

export interface EventCardProps {
	event: Event | null;
	className?: string;
	selected?: boolean;
	onToggle?: () => void;
	disabled?: boolean;
	showAddiction?: boolean;
	showProject?: boolean;
}

export function EventCard({
	event,
	className,
	selected,
	onToggle,
	disabled,
	showAddiction,
	showProject,
}: EventCardProps) {
	const img = event ? primaryImagePath(event) : null;
	const isInteractive = !disabled && !!onToggle;

	return (
		<div
			className={cn(
				"flex flex-col gap-2 p-2 rounded-lg border border-border/50 bg-muted/20 relative",
				isInteractive && "cursor-pointer hover:border-border transition-colors",
				selected && "ring-2 ring-primary border-primary",
				disabled && "opacity-50 pointer-events-none",
				className,
			)}
			onClick={isInteractive ? onToggle : undefined}
			onKeyDown={
				isInteractive
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onToggle?.();
							}
						}
					: undefined
			}
			role={isInteractive ? "button" : undefined}
			tabIndex={isInteractive ? 0 : undefined}
		>
			{selected && (
				<div className="absolute top-3 right-3 z-10 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
					<Check className="w-3 h-3 text-primary-foreground" />
				</div>
			)}
			<div className="w-full aspect-video rounded-md overflow-hidden bg-muted/40">
				{img ? (
					<img
						alt=""
						src={`local-file://${img}`}
						className="w-full h-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
						No image
					</div>
				)}
			</div>
			<div className="px-1 pb-1">
				<div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
					<span>{event ? formatTime(event.timestamp) : "Unknown event"}</span>
					{showProject && event?.project && (
						<>
							<span>·</span>
							<span className="truncate">{event.project}</span>
						</>
					)}
					{showAddiction && event?.trackedAddiction && (
						<>
							<span>·</span>
							<span className="truncate text-orange-500">
								{event.trackedAddiction}
							</span>
						</>
					)}
				</div>
				<div className="text-sm font-medium">
					{event?.caption ?? event?.appName ?? "—"}
				</div>
			</div>
		</div>
	);
}
