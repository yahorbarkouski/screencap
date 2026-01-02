export function normalizeAccelerator(
	value: string | null | undefined,
): string | null {
	const v = value?.trim() ?? "";
	return v.length > 0 ? v : null;
}

export function isMac(): boolean {
	return navigator.platform.toLowerCase().includes("mac");
}

export type AcceleratorToken = {
	type: "command" | "shift" | "control" | "alt" | "key";
	label: string;
};

export function tokenizeAccelerator(
	accelerator: string | null | undefined,
): { mac: boolean; tokens: AcceleratorToken[] } | null {
	const a = normalizeAccelerator(accelerator);
	if (!a) return null;

	const parts = a
		.split("+")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return null;

	const mac = isMac();
	const tokens: AcceleratorToken[] = [];

	for (const part of parts) {
		const lower = part.toLowerCase();
		if (
			lower === "command" ||
			lower === "commandorcontrol" ||
			lower === "super"
		) {
			tokens.push({
				type: mac ? "command" : "control",
				label: mac ? "" : "Ctrl",
			});
		} else if (lower === "control") {
			tokens.push({ type: "control", label: mac ? "⌃" : "Ctrl" });
		} else if (lower === "shift") {
			tokens.push({ type: "shift", label: mac ? "" : "Shift" });
		} else if (lower === "alt" || lower === "option") {
			tokens.push({ type: "alt", label: mac ? "⌥" : "Alt" });
		} else {
			tokens.push({ type: "key", label: part.toUpperCase() });
		}
	}

	return { mac, tokens };
}

export function formatAccelerator(
	accelerator: string | null | undefined,
): string {
	const result = tokenizeAccelerator(accelerator);
	if (!result) return "";
	const labels = result.tokens.map((t) => t.label).filter(Boolean);
	return result.mac ? labels.join("") : labels.join("+");
}
