import { useCallback, useEffect, useRef, useState } from "react";
import type { SmartReminderCapturePreviewPayload } from "../../types";
import { usePopupAutoHeight } from "./usePopupAutoHeight";

interface PopupInitData extends SmartReminderCapturePreviewPayload {
	thumbnailPath: string | null;
	originalPath: string | null;
}

export function SmartReminderPopup() {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [initData, setInitData] = useState<PopupInitData | null>(null);
	const [description, setDescription] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const submitRef = useRef<() => void>(() => {});

	usePopupAutoHeight(rootRef);

	const handleSubmit = useCallback(() => {
		if (!initData || isSubmitting || !description.trim()) return;
		setIsSubmitting(true);

		const result = {
			description,
			thumbnailPath: initData.thumbnailPath,
			originalPath: initData.originalPath,
			appBundleId: initData.appBundleId,
			windowTitle: initData.windowTitle,
			urlHost: initData.urlHost,
			contentKind: initData.contentKind,
			contextJson: initData.contextJson,
		};

		window.api.send("smart-reminder:popup-result", result);
	}, [initData, description, isSubmitting]);

	submitRef.current = handleSubmit;

	useEffect(() => {
		const handleInit = (data: PopupInitData) => {
			setInitData(data);
			setDescription("");
			setIsSubmitting(false);
		};

		const unsubscribe = window.api.on(
			"smart-reminder:popup-init" as never,
			handleInit as never,
		);

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				window.api.send("smart-reminder:popup-result", null);
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				submitRef.current();
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			unsubscribe();
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const handleCancel = useCallback(() => {
		setIsSubmitting(false);
		window.api.send("smart-reminder:popup-result", null);
	}, []);

	if (!initData) {
		return (
			<div className="flex h-screen items-center justify-center bg-neutral-900/95 text-white">
				<div className="text-sm text-neutral-400">Loading...</div>
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			className="flex h-screen flex-col bg-neutral-900/95 p-4 text-white"
		>
			<div className="mb-4 overflow-hidden rounded-lg border border-neutral-700">
				<img
					src={`data:image/jpeg;base64,${initData.imageBase64}`}
					alt="Captured region"
					className="h-48 w-full object-cover"
				/>
			</div>

			<div className="mb-4 flex-1">
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="What would you like to remember about this?"
					className="h-full w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
				/>
			</div>

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={handleCancel}
					className="rounded-lg border border-neutral-600 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={isSubmitting || !description.trim()}
					className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
				>
					Save
				</button>
			</div>
		</div>
	);
}
