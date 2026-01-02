import { RotateCcw, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/wrapped/Panel";
import { formatAccelerator, normalizeAccelerator } from "@/lib/accelerator";
import type { ShortcutSettings } from "@/types";
import { SettingsRow, SettingsRows } from "./SettingsPrimitives";

const DEFAULT_SHORTCUTS: ShortcutSettings = {
	captureNow: "Command+Shift+O",
	captureProjectProgress: "Command+Shift+P",
};

function normalizeKey(key: string): string | null {
	if (key === " ") return "Space";
	if (key === "Escape") return "Esc";
	if (key === "Enter") return "Enter";
	if (key === "Tab") return "Tab";
	if (key === "ArrowUp") return "Up";
	if (key === "ArrowDown") return "Down";
	if (key === "ArrowLeft") return "Left";
	if (key === "ArrowRight") return "Right";

	if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
	if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase();

	return null;
}

function toAccelerator(e: ReactKeyboardEvent<HTMLInputElement>): string | null {
	if (
		e.key === "Meta" ||
		e.key === "Shift" ||
		e.key === "Control" ||
		e.key === "Alt"
	)
		return null;

	const key = normalizeKey(e.key);
	if (!key) return null;

	const parts: string[] = [];
	if (e.metaKey) parts.push("Command");
	if (e.ctrlKey) parts.push("Control");
	if (e.altKey) parts.push("Alt");
	if (e.shiftKey) parts.push("Shift");

	if (parts.length === 0) return null;
	return [...parts, key].join("+");
}

function ShortcutInput({
	value,
	onChange,
	onRecordingChange,
}: {
	value: string | null;
	onChange: (next: string | null) => void;
	onRecordingChange: (recording: boolean) => void;
}) {
	const [recording, setRecording] = useState(false);
	const display = useMemo(() => formatAccelerator(value), [value]);

	return (
		<div className="flex items-center gap-2 w-full sm:w-[320px]">
			<Input
				value={recording ? "" : display}
				placeholder={recording ? "Press keys…" : display ? "" : "Disabled"}
				readOnly
				onFocus={() => {
					setRecording(true);
					onRecordingChange(true);
				}}
				onBlur={() => {
					setRecording(false);
					onRecordingChange(false);
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						(e.currentTarget as HTMLInputElement).blur();
						return;
					}

					if (e.key === "Backspace" || e.key === "Delete") {
						e.preventDefault();
						onChange(null);
						(e.currentTarget as HTMLInputElement).blur();
						return;
					}

					const accelerator = toAccelerator(e);
					if (!accelerator) return;
					e.preventDefault();
					onChange(accelerator);
					(e.currentTarget as HTMLInputElement).blur();
				}}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => onChange(null)}
				disabled={!normalizeAccelerator(value)}
			>
				<X className="h-4 w-4" />
			</Button>
		</div>
	);
}

export function ShortcutsPanel({
	shortcuts,
	onChange,
}: {
	shortcuts: ShortcutSettings;
	onChange: (next: ShortcutSettings) => void;
}) {
	const [recordingCount, setRecordingCount] = useState(0);

	const normalized = useMemo(
		() => ({
			captureNow: normalizeAccelerator(shortcuts.captureNow),
			captureProjectProgress: normalizeAccelerator(
				shortcuts.captureProjectProgress,
			),
		}),
		[shortcuts.captureNow, shortcuts.captureProjectProgress],
	);

	const duplicates = useMemo(() => {
		if (!normalized.captureNow) return false;
		return normalized.captureNow === normalized.captureProjectProgress;
	}, [normalized.captureNow, normalized.captureProjectProgress]);

	const update = useCallback(
		(key: keyof ShortcutSettings, value: string | null) => {
			const next: ShortcutSettings = { ...shortcuts, [key]: value };
			const v = normalizeAccelerator(value);
			if (v && key === "captureNow") {
				if (normalizeAccelerator(shortcuts.captureProjectProgress) === v) {
					next.captureProjectProgress = null;
				}
			}
			if (v && key === "captureProjectProgress") {
				if (normalizeAccelerator(shortcuts.captureNow) === v) {
					next.captureNow = null;
				}
			}
			onChange(next);
		},
		[onChange, shortcuts],
	);

	useEffect(() => {
		if (!window.api?.shortcuts?.setSuspended) return;
		void window.api.shortcuts.setSuspended(recordingCount > 0);
	}, [recordingCount]);

	useEffect(() => {
		return () => {
			void window.api?.shortcuts?.setSuspended(false);
		};
	}, []);

	const onRecordingChange = useCallback((recording: boolean) => {
		setRecordingCount((c) => Math.max(0, c + (recording ? 1 : -1)));
	}, []);

	return (
		<Panel
			title="Shortcuts"
			meta="Customizable global hotkeys"
			className="max-w-3xl"
			right={
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onChange(DEFAULT_SHORTCUTS)}
				>
					<RotateCcw className="h-4 w-4" />
					Reset
				</Button>
			}
		>
			<SettingsRows>
				<SettingsRow
					title="Capture now"
					description="Takes a capture immediately"
					right={
						<ShortcutInput
							value={shortcuts.captureNow}
							onChange={(v) => update("captureNow", v)}
							onRecordingChange={onRecordingChange}
						/>
					}
				/>
				<SettingsRow
					title="Capture project progress"
					description="Captures and opens the popup caption flow"
					right={
						<ShortcutInput
							value={shortcuts.captureProjectProgress}
							onChange={(v) => update("captureProjectProgress", v)}
							onRecordingChange={onRecordingChange}
						/>
					}
				/>
			</SettingsRows>
			{duplicates ? (
				<div className="mt-3 text-xs text-destructive">
					Shortcuts must be unique.
				</div>
			) : null}
			<div className="mt-2 text-xs text-muted-foreground">
				Focus an input and press keys. Backspace clears. Esc cancels.
			</div>
		</Panel>
	);
}
