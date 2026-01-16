import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "@/lib/utils";
import { useAppStore } from "@/stores/app";

const DEBOUNCE_MS = 150;

export function useEvents() {
	const events = useAppStore((s) => s.events);
	const setEvents = useAppStore((s) => s.setEvents);
	const filters = useAppStore((s) => s.filters);
	const pagination = useAppStore((s) => s.pagination);
	const isMounted = useRef(true);
	const [hasNextPage, setHasNextPage] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const requestIdRef = useRef(0);

	const fetchEvents = useCallback(async () => {
		if (!isMounted.current || !window.api) return;

		const requestId = (requestIdRef.current += 1);
		setIsLoading(true);
		try {
			const { page, pageSize } = pagination;
			const result = await window.api.storage.getEvents({
				...filters,
				limit: pageSize + 1,
				offset: page * pageSize,
			});
			if (isMounted.current && requestId === requestIdRef.current) {
				setHasNextPage(result.length > pageSize);
				setEvents(result.slice(0, pageSize));
			}
		} finally {
			if (isMounted.current && requestId === requestIdRef.current) {
				setIsLoading(false);
			}
		}
	}, [setEvents, filters, pagination]);

	const debouncedFetch = useMemo(
		() => debounce(fetchEvents, DEBOUNCE_MS),
		[fetchEvents]
	);

	useEffect(() => {
		isMounted.current = true;
		return () => {
			isMounted.current = false;
		};
	}, []);

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	useEffect(() => {
		if (!window.api) return;

		const unsubscribeCreated = window.api.on(
			"event:created",
			debouncedFetch
		);
		const unsubscribeUpdated = window.api.on(
			"event:updated",
			debouncedFetch
		);
		const unsubscribeChanged = window.api.on(
			"events:changed",
			debouncedFetch
		);
		const unsubscribeProjects = window.api.on(
			"projects:normalized",
			debouncedFetch
		);

		return () => {
			unsubscribeCreated();
			unsubscribeUpdated();
			unsubscribeChanged();
			unsubscribeProjects();
		};
	}, [debouncedFetch]);

	return { events, fetchEvents, hasNextPage, isLoading };
}
