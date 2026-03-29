import { describe, expect, it } from "vitest";
import {
	buildVirtualTimelineItems,
	estimateVirtualTimelineItemSize,
} from "../../../../src/components/timeline/virtualTimeline";
import type { Event } from "../../../../src/types";

function makeEvent(id: string, timestamp: number): Event {
	return { id, timestamp } as Event;
}

describe("buildVirtualTimelineItems", () => {
	it("flattens grouped events into headers and chunked rows", () => {
		const items = buildVirtualTimelineItems(
			[
				["Today", [makeEvent("1", 1), makeEvent("2", 2), makeEvent("3", 3)]],
				["Yesterday", [makeEvent("4", 4)]],
			],
			2,
		);

		expect(items).toHaveLength(5);
		expect(items[0]).toMatchObject({
			type: "header",
			date: "Today",
			showPagination: true,
			spacingAfter: 16,
		});
		expect(items[1]).toMatchObject({
			type: "row",
			date: "Today",
			spacingAfter: 16,
		});
		expect(
			items[1]?.type === "row" ? items[1].events.map((event) => event.id) : [],
		).toEqual(["1", "2"]);
		expect(items[2]).toMatchObject({
			type: "row",
			date: "Today",
			spacingAfter: 32,
		});
		expect(items[3]).toMatchObject({
			type: "header",
			date: "Yesterday",
			showPagination: false,
		});
		expect(items[4]).toMatchObject({
			type: "row",
			date: "Yesterday",
			spacingAfter: 0,
		});
	});

	it("falls back to a single column when the input is invalid", () => {
		const items = buildVirtualTimelineItems(
			[["Today", [makeEvent("1", 1), makeEvent("2", 2)]]],
			0,
		);

		expect(items).toHaveLength(3);
		expect(
			items[1]?.type === "row" ? items[1].events.map((event) => event.id) : [],
		).toEqual(["1"]);
		expect(
			items[2]?.type === "row" ? items[2].events.map((event) => event.id) : [],
		).toEqual(["2"]);
	});

	it("uses larger row estimates for narrower layouts", () => {
		const [wideHeader, wideRow] = buildVirtualTimelineItems(
			[["Today", [makeEvent("1", 1), makeEvent("2", 2), makeEvent("3", 3)]]],
			4,
		);
		const [narrowHeader, narrowRow] = buildVirtualTimelineItems(
			[["Today", [makeEvent("1", 1), makeEvent("2", 2), makeEvent("3", 3)]]],
			1,
		);

		expect(estimateVirtualTimelineItemSize(narrowHeader)).toBeGreaterThan(0);
		expect(estimateVirtualTimelineItemSize(narrowRow)).toBeGreaterThan(
			estimateVirtualTimelineItemSize(wideRow),
		);
		expect(estimateVirtualTimelineItemSize(wideHeader)).toBeGreaterThan(0);
	});
});
