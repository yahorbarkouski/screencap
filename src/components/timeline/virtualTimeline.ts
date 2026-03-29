import type { Event } from "../../types";

const HEADER_GAP_PX = 16;
const ROW_GAP_PX = 16;
const GROUP_GAP_PX = 32;

const HEADER_ESTIMATE_PX = 28;
const PAGINATED_HEADER_ESTIMATE_PX = 36;

const ROW_ESTIMATE_BY_COLUMNS: Record<number, number> = {
	1: 520,
	2: 400,
	3: 320,
	4: 280,
};

export type VirtualTimelineItem =
	| {
			type: "header";
			date: string;
			key: string;
			showPagination: boolean;
			spacingAfter: number;
			estimatedSize: number;
	  }
	| {
			type: "row";
			date: string;
			events: Event[];
			key: string;
			spacingAfter: number;
			estimatedSize: number;
	  };

function chunkEvents(events: Event[], size: number): Event[][] {
	const rows: Event[][] = [];
	for (let index = 0; index < events.length; index += size) {
		rows.push(events.slice(index, index + size));
	}
	return rows;
}

function getRowEstimate(columns: number): number {
	return ROW_ESTIMATE_BY_COLUMNS[columns] ?? ROW_ESTIMATE_BY_COLUMNS[4];
}

export function buildVirtualTimelineItems(
	groups: Array<readonly [string, Event[]]>,
	columns: number,
): VirtualTimelineItem[] {
	const safeColumns = Math.max(1, Math.floor(columns) || 1);
	const rowEstimate = getRowEstimate(safeColumns);
	const items: VirtualTimelineItem[] = [];

	groups.forEach(([date, events], groupIndex) => {
		const rows = chunkEvents(events, safeColumns);
		const isLastGroup = groupIndex === groups.length - 1;

		items.push({
			type: "header",
			date,
			key: `header:${date}`,
			showPagination: groupIndex === 0,
			spacingAfter:
				rows.length > 0 ? HEADER_GAP_PX : isLastGroup ? 0 : GROUP_GAP_PX,
			estimatedSize:
				groupIndex === 0 ? PAGINATED_HEADER_ESTIMATE_PX : HEADER_ESTIMATE_PX,
		});

		rows.forEach((rowEvents, rowIndex) => {
			const isLastRow = rowIndex === rows.length - 1;
			items.push({
				type: "row",
				date,
				events: rowEvents,
				key: `row:${date}:${rowIndex}`,
				spacingAfter: isLastRow ? (isLastGroup ? 0 : GROUP_GAP_PX) : ROW_GAP_PX,
				estimatedSize: rowEstimate,
			});
		});
	});

	return items;
}

export function estimateVirtualTimelineItemSize(
	item: VirtualTimelineItem | undefined,
): number {
	if (!item) return 0;
	return item.estimatedSize + item.spacingAfter;
}
