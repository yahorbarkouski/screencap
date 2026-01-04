import { Copy, Expand } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn, formatTime } from "@/lib/utils";
import type { SharedEvent } from "@/types";
import { AuthorAvatar } from "./AuthorAvatar";

export function SharedProgressCard({
	event,
	showProject = false,
	projectName,
	isLast = false,
	isMe = false,
}: {
	event: SharedEvent;
	showProject?: boolean;
	projectName?: string;
	isLast?: boolean;
	isMe?: boolean;
}) {
	const [previewOpen, setPreviewOpen] = useState(false);
	const timeLabel = formatTime(event.timestampMs);

	const handleCopyImage = useCallback(async () => {
		if (event.imageCachePath) {
			await window.api.app.copyImage(event.imageCachePath);
		}
	}, [event.imageCachePath]);

	const handleExpand = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setPreviewOpen(true);
	}, []);

	return (
		<div className="grid grid-cols-[96px,1fr] gap-4">
			<div className="relative">
				<div className="pr-4 pt-1 text-right font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
					{timeLabel}
				</div>
				<div className="absolute -right-0.5 top-2 h-2 w-2 rounded-full bg-primary" />
				{!isLast && (
					<div className="absolute right-[2px] top-5 -bottom-7 w-px bg-primary/40" />
				)}
			</div>

			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						onClick={() => setPreviewOpen(true)}
						className={cn(
							"group relative overflow-hidden rounded-xl border border-border bg-card text-left cursor-pointer",
							"hover:border-primary/40 transition-colors",
						)}
					>
						<div className="relative aspect-video bg-muted">
							{event.imageCachePath ? (
								<img
									src={`local-file://${event.imageCachePath}`}
									alt=""
									className="h-full w-full object-cover"
									loading="lazy"
								/>
							) : (
								<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
									Image syncing...
								</div>
							)}

							<div className="absolute top-2 left-2">
								<AuthorAvatar
									username={event.authorUsername}
									isMe={isMe}
									size="md"
								/>
							</div>

							<div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button
									type="button"
									onClick={handleExpand}
									className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white/90 hover:text-white transition-colors"
								>
									<Expand className="h-4 w-4" />
								</button>
							</div>

							{(event.caption || showProject) && (
								<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
									<div className="flex items-end justify-between gap-3">
										<div className="min-w-0">
											{event.caption && (
												<div className="truncate text-sm font-medium text-white/90">
													{event.caption}
												</div>
											)}
											{showProject && projectName && (
												<div className="mt-1 truncate text-xs text-white/70">
													{projectName}
												</div>
											)}
										</div>

										<div className="shrink-0">
											<Badge className="bg-primary/90 text-primary-foreground border-0">
												Progress
											</Badge>
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						onSelect={handleCopyImage}
						disabled={!event.imageCachePath}
					>
						<Copy className="mr-2 h-4 w-4" />
						Copy image
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{previewOpen && event.imageCachePath && (
				<div
					className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
					onClick={() => setPreviewOpen(false)}
				>
					<img
						src={`local-file://${event.imageCachePath}`}
						alt=""
						className="max-h-full max-w-full object-contain rounded-lg"
					/>
				</div>
			)}
		</div>
	);
}
