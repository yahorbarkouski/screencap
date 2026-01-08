import { format, startOfDay } from "date-fns";
import { v4 as uuid } from "uuid";
import type { EodContent, EodSection, Event } from "@/types";

export type Step = "summary" | "progress" | "addictions" | "write" | "review";

export function dayStartMsOf(timestamp: number): number {
	return startOfDay(new Date(timestamp)).getTime();
}

export function buildDefaultContent(): EodContent {
	return {
		version: 1,
		sections: [
			{ id: uuid(), title: "Overview", body: "", attachments: [] },
			{ id: uuid(), title: "TILs", body: "", attachments: [] },
		],
	};
}

export function formatMinutes(minutes: number): string {
	if (minutes <= 0) return "0m";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h <= 0) return `${m}m`;
	if (m <= 0) return `${h}h`;
	return `${h}h ${m}m`;
}

export function normalizeTitle(title: string): string {
	return title.trim().toLowerCase();
}

export function upsertSection(
	sections: EodSection[],
	sectionId: string,
	update: (section: EodSection) => EodSection,
): EodSection[] {
	return sections.map((s) => (s.id === sectionId ? update(s) : s));
}

export function removeSection(
	sections: EodSection[],
	sectionId: string,
): EodSection[] {
	return sections.filter((s) => s.id !== sectionId);
}

export function formatDayTitle(dayStartMs: number): string {
	return format(new Date(dayStartMs), "MMMM d");
}

export function primaryImagePath(e: Event): string | null {
	return e.originalPath ?? e.thumbnailPath ?? null;
}
