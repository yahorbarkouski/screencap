export type ActivitySegment = {
	key: string;
	bundleId: string;
	displayId: string;
	urlHost: string | null;
	startAt: number;
	endAt: number | null;
};

export function computeDominantSegment(
	segments: ActivitySegment[],
	windowEnd: number,
	minTotalMs: number,
): {
	key: string;
	bundleId: string;
	displayId: string;
	urlHost: string | null;
} | null {
	const totals = new Map<
		string,
		{
			durationMs: number;
			bundleId: string;
			displayId: string;
			urlHost: string | null;
		}
	>();

	for (const s of segments) {
		const endAt = s.endAt ?? windowEnd;
		const durationMs = endAt - s.startAt;
		if (durationMs <= 0) continue;

		const prev = totals.get(s.key);
		if (prev) {
			prev.durationMs += durationMs;
		} else {
			totals.set(s.key, {
				durationMs,
				bundleId: s.bundleId,
				displayId: s.displayId,
				urlHost: s.urlHost,
			});
		}
	}

	let best: {
		key: string;
		bundleId: string;
		displayId: string;
		urlHost: string | null;
	} | null = null;
	let bestDuration = 0;

	for (const [key, data] of totals.entries()) {
		if (data.durationMs < minTotalMs) continue;
		if (data.durationMs > bestDuration) {
			bestDuration = data.durationMs;
			best = {
				key,
				bundleId: data.bundleId,
				displayId: data.displayId,
				urlHost: data.urlHost,
			};
		}
	}

	return best;
}
