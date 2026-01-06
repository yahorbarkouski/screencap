import { format } from "date-fns";
import { ExternalLink, Globe, Music, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SharedEvent } from "@/types";

function highResPathFromOriginal(path: string | null): string | null {
	if (!path) return null;
	if (!path.endsWith(".webp")) return null;
	return path.replace(/\.webp$/, ".hq.png");
}

interface EventPreviewModalProps {
	event: SharedEvent | null;
	onClose: () => void;
}

export function EventPreviewModal({ event, onClose }: EventPreviewModalProps) {
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		},
		[onClose],
	);

	const basePath = event
		? (event.originalPath ?? event.thumbnailPath ?? event.imageRef ?? null)
		: null;
	const hqPath = event
		? highResPathFromOriginal(event.originalPath ?? null)
		: null;
	const [currentPath, setCurrentPath] = useState<string | null>(
		hqPath ?? basePath,
	);

	useEffect(() => {
		if (!event) return;
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [event, handleKeyDown]);

	useEffect(() => {
		setCurrentPath(hqPath ?? basePath);
	}, [hqPath, basePath]);

	if (!event) return null;
	if (!currentPath) return null;

	const imageUrl = currentPath.startsWith("local-file://")
		? currentPath
		: currentPath.startsWith("http")
			? currentPath
			: `local-file://${currentPath}`;

	const handleOpenUrl = (url: string | null) => {
		if (url) {
			window.api?.app.openExternal(url);
		}
	};

	const backgroundItem = event.background?.[0];

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-8">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/90 backdrop-blur-sm"
				onClick={onClose}
			/>

			{/* Content */}
			<div className="relative z-10 flex max-h-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background/5 shadow-2xl backdrop-blur-md ring-1 ring-white/10">
				{/* Close button */}
				<div className="absolute right-4 top-4 z-20">
					<Button
						variant="ghost"
						size="icon"
						className="h-10 w-10 rounded-full bg-black/50 hover:bg-black/70 text-white"
						onClick={onClose}
					>
						<X className="h-5 w-5" />
					</Button>
				</div>

				{/* Image */}
				<div className="flex-1 overflow-hidden bg-black/20">
					<img
						src={imageUrl}
						alt=""
						className="h-full w-full object-contain"
						onError={() => {
							if (hqPath && currentPath === hqPath && basePath) {
								setCurrentPath(basePath);
							}
						}}
					/>
				</div>

				{/* Metadata Footer */}
				<div className="bg-background/95 px-6 py-4 backdrop-blur-xl border-t border-white/10">
					<div className="flex items-start justify-between gap-8">
						<div className="space-y-1">
							<div className="flex items-center gap-2">
								<div className="text-lg font-medium text-foreground">
									{event.appName || "Unknown App"}
								</div>
								<span className="text-muted-foreground">·</span>
								<div className="text-sm text-muted-foreground">
									{format(event.timestampMs, "h:mm a")}
								</div>
							</div>
							{event.windowTitle && (
								<div className="text-sm text-muted-foreground/80 line-clamp-1">
									{event.windowTitle}
								</div>
							)}
						</div>

						<div className="flex flex-col items-end gap-2">
							{/* Website Link */}
							{event.url && (
								<Button
									variant="outline"
									size="sm"
									className="h-8 gap-2 bg-white/5 hover:bg-white/10 border-white/10"
									onClick={() => handleOpenUrl(event.url)}
								>
									<Globe className="h-3.5 w-3.5" />
									<span className="max-w-[200px] truncate">
										{new URL(event.url).hostname}
									</span>
									<ExternalLink className="h-3 w-3 opacity-50" />
								</Button>
							)}

							{/* Background Activity */}
							{backgroundItem && (
								<Button
									variant="ghost"
									size="sm"
									className="h-auto py-1.5 px-3 gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full"
									onClick={() => handleOpenUrl(backgroundItem.actionUrl)}
									disabled={!backgroundItem.actionUrl}
								>
									{backgroundItem.imageUrl ? (
										<img
											src={backgroundItem.imageUrl}
											alt=""
											className="h-8 w-8 rounded-md object-cover"
										/>
									) : (
										<div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10">
											<Music className="h-4 w-4" />
										</div>
									)}
									<div className="flex flex-col items-start text-left">
										<div className="text-xs font-medium leading-none">
											{backgroundItem.title}
										</div>
										{backgroundItem.subtitle && (
											<div className="text-[10px] text-muted-foreground mt-0.5">
												{backgroundItem.subtitle}
											</div>
										)}
									</div>
									{backgroundItem.actionUrl && (
										<ExternalLink className="h-3 w-3 opacity-50" />
									)}
								</Button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
