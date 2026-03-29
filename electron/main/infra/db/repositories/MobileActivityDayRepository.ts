import type {
	MobileActivityDay,
	MobileActivityHourBucket,
} from "../../../../shared/types";
import { getDatabase, isDbOpen } from "../connection";

type MobileActivityDayRow = {
	device_id: string;
	device_name: string | null;
	platform: "ios";
	day_start_ms: number;
	buckets_json: string;
	synced_at: number;
};

function parseBuckets(value: string): MobileActivityHourBucket[] | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return null;
		return parsed
			.map((item) => {
				if (!item || typeof item !== "object") return null;
				const bucket = item as Partial<MobileActivityHourBucket>;
				if (
					typeof bucket.hour !== "number" ||
					!Number.isInteger(bucket.hour) ||
					bucket.hour < 0 ||
					bucket.hour > 23 ||
					typeof bucket.durationSeconds !== "number" ||
					!Number.isFinite(bucket.durationSeconds) ||
					bucket.durationSeconds < 0 ||
					typeof bucket.category !== "string"
				) {
					return null;
				}
				return {
					hour: bucket.hour,
					durationSeconds: Math.trunc(bucket.durationSeconds),
					category: bucket.category,
					appName:
						typeof bucket.appName === "string" && bucket.appName.trim()
							? bucket.appName
							: null,
				};
			})
			.filter((bucket): bucket is MobileActivityHourBucket => bucket !== null);
	} catch {
		return null;
	}
}

function rowToDay(row: MobileActivityDayRow): MobileActivityDay | null {
	const buckets = parseBuckets(row.buckets_json);
	if (!buckets) return null;
	return {
		deviceId: row.device_id,
		deviceName: row.device_name,
		platform: row.platform,
		dayStartMs: row.day_start_ms,
		buckets,
		syncedAt: row.synced_at,
	};
}

export function listCachedMobileActivityDays(params: {
	startDate?: number;
	endDate?: number;
}): MobileActivityDay[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const conditions: string[] = ["1 = 1"];
	const args: Array<number> = [];

	if (params.startDate !== undefined) {
		conditions.push("day_start_ms >= ?");
		args.push(params.startDate);
	}

	if (params.endDate !== undefined) {
		conditions.push("day_start_ms <= ?");
		args.push(params.endDate);
	}

	const rows = db
		.prepare(
			`SELECT device_id, device_name, platform, day_start_ms, buckets_json, synced_at
			 FROM mobile_activity_days_cache
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY day_start_ms DESC, device_id ASC`,
		)
		.all(...args) as MobileActivityDayRow[];

	return rows
		.map(rowToDay)
		.filter((day): day is MobileActivityDay => day !== null);
}

export function upsertCachedMobileActivityDays(
	days: MobileActivityDay[],
): void {
	if (!isDbOpen()) return;
	if (days.length === 0) return;

	const db = getDatabase();
	const stmt = db.prepare(
		`INSERT INTO mobile_activity_days_cache (
			device_id,
			device_name,
			platform,
			day_start_ms,
			buckets_json,
			synced_at
		)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (device_id, day_start_ms) DO UPDATE SET
			device_name = excluded.device_name,
			platform = excluded.platform,
			buckets_json = excluded.buckets_json,
			synced_at = excluded.synced_at`,
	);

	db.transaction(() => {
		for (const day of days) {
			stmt.run(
				day.deviceId,
				day.deviceName,
				day.platform,
				day.dayStartMs,
				JSON.stringify(day.buckets),
				day.syncedAt,
			);
		}
	})();
}

export function deleteCachedMobileActivityDaysByDeviceId(
	deviceId: string,
): void {
	if (!isDbOpen()) return;
	const db = getDatabase();
	db.prepare("DELETE FROM mobile_activity_days_cache WHERE device_id = ?").run(
		deviceId,
	);
}
