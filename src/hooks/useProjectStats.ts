import { useCallback, useEffect, useRef, useState } from "react";

export interface ProjectStats {
	eventCount: number;
	lastEventAt: number | null;
	coverCandidates: string[];
}

function toCandidates(item: {
	coverThumbnailPath: string | null;
	coverOriginalPath: string | null;
}): string[] {
	const candidates = [item.coverOriginalPath, item.coverThumbnailPath].filter(
		(v): v is string => typeof v === "string" && v.length > 0,
	);
	return [...new Set(candidates)];
}

export function useProjectStats(projectNames: string[]) {
	const [stats, setStats] = useState<Record<string, ProjectStats>>({});
	const [isLoading, setIsLoading] = useState(true);

	const fetchStats = useCallback(async () => {
		if (!window.api || projectNames.length === 0) {
			setStats({});
			setIsLoading(false);
			return;
		}

		setIsLoading(true);

		const batch = await window.api.storage.getProjectStatsBatch(projectNames);

		const newStats: Record<string, ProjectStats> = {};
		for (const name of projectNames) {
			const item = batch[name];
			if (item) {
				newStats[name] = {
					eventCount: item.eventCount,
					lastEventAt: item.lastEventAt,
					coverCandidates: toCandidates(item),
				};
			} else {
				newStats[name] = {
					eventCount: 0,
					lastEventAt: null,
					coverCandidates: [],
				};
			}
		}

		setStats(newStats);
		setIsLoading(false);
	}, [projectNames]);

	useEffect(() => {
		fetchStats();
	}, [fetchStats]);

	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	const debouncedFetchStats = useCallback(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(fetchStats, 5_000);
	}, [fetchStats]);

	useEffect(() => {
		if (!window.api) return;

		const unsubscribeCreated = window.api.on(
			"event:created",
			debouncedFetchStats,
		);
		const unsubscribeUpdated = window.api.on(
			"event:updated",
			debouncedFetchStats,
		);
		const unsubscribeChanged = window.api.on(
			"events:changed",
			debouncedFetchStats,
		);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			unsubscribeCreated();
			unsubscribeUpdated();
			unsubscribeChanged();
		};
	}, [debouncedFetchStats]);

	return { stats, isLoading, refetch: fetchStats };
}
