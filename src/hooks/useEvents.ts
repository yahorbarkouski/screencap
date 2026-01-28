import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app";

export function useEvents() {
	const events = useAppStore((s) => s.events);
	const setEvents = useAppStore((s) => s.setEvents);
	const filters = useAppStore((s) => s.filters);
	const pagination = useAppStore((s) => s.pagination);
	const isMounted = useRef(true);
	const [hasNextPage, setHasNextPage] = useState(false);
	const [totalPages, setTotalPages] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const requestIdRef = useRef(0);

	const fetchEvents = useCallback(async () => {
		if (!isMounted.current || !window.api) return;

		const requestId = (requestIdRef.current += 1);
		setIsLoading(true);
		try {
			const { page, pageSize } = pagination;
			const [result, count] = await Promise.all([
				window.api.storage.getEvents({
					...filters,
					limit: pageSize + 1,
					offset: page * pageSize,
				}),
				window.api.storage.getEventsCount(filters),
			]);
			if (isMounted.current && requestId === requestIdRef.current) {
				setHasNextPage(result.length > pageSize);
				setTotalPages(Math.max(1, Math.ceil(count / pageSize)));
				setEvents(result.slice(0, pageSize));
			}
		} finally {
			if (isMounted.current && requestId === requestIdRef.current) {
				setIsLoading(false);
			}
		}
	}, [setEvents, filters, pagination]);

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

		const unsubscribeCreated = window.api.on("event:created", () => {
			fetchEvents();
		});

		const unsubscribeUpdated = window.api.on("event:updated", () => {
			fetchEvents();
		});

		const unsubscribeChanged = window.api.on("events:changed", () => {
			fetchEvents();
		});

		const unsubscribeProjects = window.api.on("projects:normalized", () => {
			fetchEvents();
		});

		return () => {
			unsubscribeCreated();
			unsubscribeUpdated();
			unsubscribeChanged();
			unsubscribeProjects();
		};
	}, [fetchEvents]);

	return { events, fetchEvents, hasNextPage, totalPages, isLoading };
}
