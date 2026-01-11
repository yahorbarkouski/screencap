import { format, startOfDay } from "date-fns";
import { v4 as uuid } from "uuid";
import type {
	EodBlock,
	EodContent,
	EodContentV1,
	EodContentV2,
	EodSection,
	EodSectionV1,
	Event,
} from "@/types";

export type Step = "summary" | "progress" | "addictions" | "write";

export function dayStartMsOf(timestamp: number): number {
	return startOfDay(new Date(timestamp)).getTime();
}

function migrateSectionV1ToV2(section: EodSectionV1): EodSection {
	const blocks: EodBlock[] = [];

	if (section.body.trim()) {
		blocks.push({ kind: "text", id: uuid(), content: section.body });
	}

	for (const attachment of section.attachments) {
		if (attachment.kind === "event") {
			blocks.push({
				kind: "event",
				id: uuid(),
				eventId: attachment.eventId,
			});
		}
	}

	if (blocks.length === 0) {
		blocks.push({ kind: "text", id: uuid(), content: "" });
	}

	return {
		id: section.id,
		title: section.title,
		blocks,
	};
}

export function migrateContentToV2(content: EodContent): EodContentV2 {
	if (content.version === 2) {
		return content;
	}

	const v1 = content as EodContentV1;
	return {
		version: 2,
		sections: v1.sections.map(migrateSectionV1ToV2),
		summaryEventCount: v1.summaryEventCount,
	};
}

export function createTextBlock(content = ""): EodBlock {
	return { kind: "text", id: uuid(), content };
}

export function createEventBlock(eventId: string): EodBlock {
	return { kind: "event", id: uuid(), eventId };
}

export function buildDefaultContent(): EodContentV2 {
	return {
		version: 2,
		sections: [
			{ id: uuid(), title: "Overview", blocks: [createTextBlock()] },
			{ id: uuid(), title: "TILs", blocks: [createTextBlock()] },
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

export function updateBlock(
	blocks: EodBlock[],
	blockId: string,
	update: (block: EodBlock) => EodBlock,
): EodBlock[] {
	return blocks.map((b) => (b.id === blockId ? update(b) : b));
}

export function insertBlockAfter(
	blocks: EodBlock[],
	afterBlockId: string,
	newBlock: EodBlock,
): EodBlock[] {
	const index = blocks.findIndex((b) => b.id === afterBlockId);
	if (index === -1) return [...blocks, newBlock];
	return [...blocks.slice(0, index + 1), newBlock, ...blocks.slice(index + 1)];
}

export function removeBlock(blocks: EodBlock[], blockId: string): EodBlock[] {
	const filtered = blocks.filter((b) => b.id !== blockId);
	if (filtered.length === 0) {
		return [createTextBlock()];
	}
	return filtered;
}

export function formatDayTitle(dayStartMs: number): string {
	return format(new Date(dayStartMs), "MMMM d");
}

export function primaryImagePath(e: Event): string | null {
	return e.originalPath ?? e.thumbnailPath ?? null;
}

export function getSectionText(section: EodSection): string {
	return section.blocks
		.filter((b): b is Extract<EodBlock, { kind: "text" }> => b.kind === "text")
		.map((b) => b.content)
		.join("\n");
}

export function setSectionText(section: EodSection, text: string): EodSection {
	const eventBlocks = section.blocks.filter((b) => b.kind === "event");
	return {
		...section,
		blocks: [createTextBlock(text), ...eventBlocks],
	};
}
