import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "../dominance";
import { computeDominantSegment } from "../dominance";

describe("computeDominantSegment", () => {
	it("picks dominant key while ignoring short interruptions", () => {
		const segments: ActivitySegment[] = [
			{
				key: "1::work",
				bundleId: "work",
				displayId: "1",
				urlHost: null,
				startAt: 0,
				endAt: 300_000,
			},
			{
				key: "1::spotify",
				bundleId: "spotify",
				displayId: "1",
				urlHost: null,
				startAt: 300_000,
				endAt: 301_000,
			},
			{
				key: "1::work",
				bundleId: "work",
				displayId: "1",
				urlHost: null,
				startAt: 301_000,
				endAt: 601_000,
			},
		];

		const dominant = computeDominantSegment(segments, 601_000, 10_000);
		expect(dominant?.key).toBe("1::work");
		expect(dominant?.bundleId).toBe("work");
		expect(dominant?.displayId).toBe("1");
	});

	it("returns null when nothing clears interruption threshold", () => {
		const segments: ActivitySegment[] = [
			{
				key: "1::a",
				bundleId: "a",
				displayId: "1",
				urlHost: null,
				startAt: 0,
				endAt: 5_000,
			},
			{
				key: "1::b",
				bundleId: "b",
				displayId: "1",
				urlHost: null,
				startAt: 5_000,
				endAt: 9_000,
			},
		];

		const dominant = computeDominantSegment(segments, 9_000, 10_000);
		expect(dominant).toBeNull();
	});

	it("includes segments exactly at the interruption threshold", () => {
		const segments: ActivitySegment[] = [
			{
				key: "1::a",
				bundleId: "a",
				displayId: "1",
				urlHost: null,
				startAt: 0,
				endAt: 10_000,
			},
		];

		const dominant = computeDominantSegment(segments, 10_000, 10_000);
		expect(dominant?.key).toBe("1::a");
	});
});

