import { Loader2, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectProgressPreview } from "@/types";
import { useLockBodyScroll } from "./useLockBodyScroll";

function uniqueSorted(values: string[]): string[] {
	const map = new Map<string, string>();
	for (const v of values) {
		const trimmed = v.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (!map.has(key)) map.set(key, trimmed);
	}
	return Array.from(map.values()).sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base" }),
	);
}

const AUTO_PROJECT_VALUE = "__auto__";

type Phase = "idle" | "ready" | "submitting";

const PreviewImage = memo(function PreviewImage({ src }: { src: string }) {
	return <img src={src} alt="" className="w-full h-auto object-contain" />;
});

export function ProjectProgressCapturePopup() {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const captionRef = useRef<HTMLTextAreaElement | null>(null);
	const [projectOptions, setProjectOptions] = useState<string[]>([]);

	const [phase, setPhase] = useState<Phase>("idle");
	const eventIdRef = useRef<string | null>(null);
	const eventIdResolveRef = useRef<((id: string) => void) | null>(null);
	const imageUrlRef = useRef<string | null>(null);
	const [caption, setCaption] = useState("");
	const [project, setProject] = useState<string | null>(null);

	useLockBodyScroll(true);

	useEffect(() => {
		if (!window.api) return;
		void window.api.storage
			.getMemories("project")
			.then((memories) => {
				setProjectOptions(uniqueSorted(memories.map((m) => m.content)));
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on(
			"shortcut:capture-project-progress-preview",
			(data: unknown) => {
				const preview = data as ProjectProgressPreview;
				if (!preview?.imageBase64) return;
				imageUrlRef.current = `data:image/jpeg;base64,${preview.imageBase64}`;
				setProject(preview.project);
				setPhase("ready");
			},
		);
	}, []);

	useEffect(() => {
		if (!window.api) return;
		return window.api.on("shortcut:capture-project-progress", (id: unknown) => {
			if (typeof id !== "string" || !id.trim()) return;
			eventIdRef.current = id.trim();
			eventIdResolveRef.current?.(id.trim());
		});
	}, []);

	useEffect(() => {
		if (phase === "ready") {
			captionRef.current?.focus();
		}
	}, [phase]);

	const cancel = useCallback(() => {
		if (!window.api) {
			window.close();
			return;
		}
		if (eventIdRef.current) {
			void window.api.storage.deleteEvent(eventIdRef.current);
		}
		window.close();
	}, []);

	useEffect(() => {
		if (phase === "idle") return;
		const handler = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			cancel();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [cancel, phase]);

	const submit = useCallback(async () => {
		if (!window.api) return;
		if (phase !== "ready") return;
		setPhase("submitting");

		let eventId = eventIdRef.current;
		if (!eventId) {
			eventId = await new Promise<string>((resolve) => {
				eventIdResolveRef.current = resolve;
			});
		}

		await window.api.storage
			.submitProjectProgressCapture({
				id: eventId,
				caption: caption.trim(),
				project,
			})
			.finally(() => {
				window.close();
			});
	}, [phase, caption, project]);

	const canEdit = phase === "ready";
	const isSubmitting = phase === "submitting";
	const imageUrl = imageUrlRef.current;

	const statusText = phase === "submitting" ? "Saving…" : "⌘↵ to send";

	if (phase === "idle") {
		return (
			<div
				ref={rootRef}
				className="relative w-full h-screen bg-background/95 backdrop-blur-xl p-4 rounded-xl border border-border"
			>
				<div className="flex items-center justify-center rounded-xl border border-border bg-muted/30 p-10">
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			className="relative w-full h-screen bg-background/95 backdrop-blur-xl p-4 rounded-xl border border-border flex flex-col"
		>
			<div className="drag-region flex items-start justify-between gap-3 mb-3">
				<div className="min-w-0 pr-2">
					<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
						PROJECT PROGRESS
					</div>
					<div className="mt-1 text-sm font-medium text-foreground/90">
						Add a caption
					</div>
				</div>

				<div className="no-drag flex items-center gap-1">
					<button
						type="button"
						aria-label="Close"
						className="no-drag inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
						onClick={cancel}
					>
						<X className="size-3" />
					</button>
				</div>
			</div>

			<div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
				{imageUrl && <PreviewImage src={imageUrl} />}
			</div>

			<div className="mt-3 flex-1 flex flex-col space-y-3 min-h-0">
				<div className="space-y-2">
					<div className="text-[10px] font-mono tracking-[0.22em] text-muted-foreground">
						RELATED PROJECT
					</div>
					<Select
						value={project ?? AUTO_PROJECT_VALUE}
						onValueChange={(value) => {
							setProject(value === AUTO_PROJECT_VALUE ? null : value);
						}}
						disabled={!canEdit || isSubmitting}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Auto" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={AUTO_PROJECT_VALUE}>Auto</SelectItem>
							{projectOptions.length > 0 ? (
								<>
									<SelectSeparator />
									{projectOptions.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</>
							) : null}
						</SelectContent>
					</Select>
				</div>

				<div className="flex-1 flex flex-col space-y-2 min-h-0">
					<Textarea
						ref={captionRef}
						value={caption}
						onChange={(e) => setCaption(e.target.value)}
						placeholder="What changed?"
						className="flex-1 min-h-[96px] resize-none"
						disabled={!canEdit || isSubmitting}
						onKeyDown={(e) => {
							const isSend = (e.metaKey || e.ctrlKey) && e.key === "Enter";
							if (!isSend) return;
							e.preventDefault();
							if (phase === "ready") {
								void submit();
							}
						}}
					/>
					<div className="flex items-center justify-between text-[11px] text-muted-foreground">
						<span className="min-w-[80px]">{statusText}</span>
						<span>{caption.trim().length}/5000</span>
					</div>
				</div>
			</div>
		</div>
	);
}
