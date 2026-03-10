import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileActivityDay } from "../../../../../shared/types";
import {
	listCachedMobileActivityDays,
	upsertCachedMobileActivityDays,
} from "../MobileActivityDayRepository";

vi.mock("../../connection", () => {
	let mockRows: Record<string, MobileActivityDay> = {};

	const mockDb = {
		prepare: (sql: string) => ({
			all: (...args: number[]) => {
				let rows = Object.values(mockRows);
				const hasStart = sql.includes("day_start_ms >= ?");
				const hasEnd = sql.includes("day_start_ms <= ?");
				const startDate = hasStart ? args[0] : undefined;
				const endDate = hasEnd ? args[hasStart ? 1 : 0] : undefined;

				rows = rows.filter((row) => {
					if (startDate !== undefined && row.dayStartMs < startDate)
						return false;
					if (endDate !== undefined && row.dayStartMs > endDate) return false;
					return true;
				});

				return rows
					.sort(
						(a, b) =>
							b.dayStartMs - a.dayStartMs ||
							a.deviceId.localeCompare(b.deviceId),
					)
					.map((row) => ({
						device_id: row.deviceId,
						device_name: row.deviceName,
						platform: row.platform,
						day_start_ms: row.dayStartMs,
						buckets_json: JSON.stringify(row.buckets),
						synced_at: row.syncedAt,
					}));
			},
			run: (...args: unknown[]) => {
				if (!sql.includes("INSERT INTO mobile_activity_days_cache")) return;
				const [
					deviceId,
					deviceName,
					platform,
					dayStartMs,
					bucketsJson,
					syncedAt,
				] = args as [string, string | null, "ios", number, string, number];
				mockRows[`${deviceId}:${dayStartMs}`] = {
					deviceId,
					deviceName,
					platform,
					dayStartMs,
					buckets: JSON.parse(bucketsJson) as MobileActivityDay["buckets"],
					syncedAt,
				};
			},
		}),
		transaction: (fn: () => void) => () => {
			fn();
		},
	};

	return {
		isDbOpen: () => true,
		getDatabase: () => mockDb,
		__resetMockRows: () => {
			mockRows = {};
		},
	};
});

describe("MobileActivityDayRepository", () => {
	beforeEach(async () => {
		const { __resetMockRows } = (await import(
			"../../connection"
		)) as unknown as {
			__resetMockRows: () => void;
		};
		__resetMockRows();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("upserts and lists mobile activity days by date range", () => {
		const day1: MobileActivityDay = {
			deviceId: "ios-1",
			deviceName: "Personal iPhone",
			platform: "ios",
			dayStartMs: 1_700_000_000_000,
			buckets: [
				{
					hour: 9,
					durationSeconds: 1800,
					category: "Work",
					appName: "Slack",
				},
			],
			syncedAt: 1_700_000_100_000,
		};
		const day2: MobileActivityDay = {
			...day1,
			dayStartMs: 1_700_086_400_000,
			buckets: [
				{
					hour: 12,
					durationSeconds: 3600,
					category: "Study",
					appName: "Duolingo",
				},
			],
		};

		upsertCachedMobileActivityDays([day1, day2]);

		const result = listCachedMobileActivityDays({
			startDate: day1.dayStartMs,
			endDate: day1.dayStartMs,
		});

		expect(result).toEqual([day1]);
	});

	it("updates an existing device/day row on conflict", () => {
		const original: MobileActivityDay = {
			deviceId: "ios-1",
			deviceName: "Personal iPhone",
			platform: "ios",
			dayStartMs: 1_700_000_000_000,
			buckets: [
				{
					hour: 9,
					durationSeconds: 900,
					category: "Work",
					appName: "Mail",
				},
			],
			syncedAt: 1_700_000_100_000,
		};
		const updated: MobileActivityDay = {
			...original,
			buckets: [
				{
					hour: 9,
					durationSeconds: 1800,
					category: "Work",
					appName: "Slack",
				},
			],
			syncedAt: 1_700_000_200_000,
		};

		upsertCachedMobileActivityDays([original]);
		upsertCachedMobileActivityDays([updated]);

		const result = listCachedMobileActivityDays({
			startDate: original.dayStartMs,
			endDate: original.dayStartMs,
		});

		expect(result).toEqual([updated]);
	});
});
