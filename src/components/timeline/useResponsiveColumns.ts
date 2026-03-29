import { type RefObject, useEffect, useState } from "react";

function getColumnCount(width: number): number {
	if (width >= 1280) return 4;
	if (width >= 1024) return 3;
	if (width >= 768) return 2;
	return 1;
}

export function useResponsiveColumns(
	containerRef: RefObject<HTMLElement | null>,
): number {
	const [columns, setColumns] = useState(4);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const updateColumns = (width: number) => {
			setColumns((current) => {
				const next = getColumnCount(width);
				return current === next ? current : next;
			});
		};

		updateColumns(container.getBoundingClientRect().width);

		const observer = new ResizeObserver((entries) => {
			const width =
				entries[0]?.contentRect.width ??
				container.getBoundingClientRect().width;
			updateColumns(width);
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, [containerRef]);

	return columns;
}
