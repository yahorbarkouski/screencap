import { useCallback, useEffect, useRef, useState } from "react";

interface DisplayInfo {
	id: string;
	bounds: { x: number; y: number; width: number; height: number };
	scaleFactor: number;
}

interface OverlayInitData {
	displays: DisplayInfo[];
	offset: { x: number; y: number };
}

interface SelectionBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	displayId: string;
	scaleFactor: number;
	appBundleId?: string | null;
	appName?: string | null;
	windowTitle?: string | null;
}

export function SelectionOverlay() {
	const [displays, setDisplays] = useState<DisplayInfo[]>([]);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [isSelecting, setIsSelecting] = useState(false);
	const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [currentPoint, setCurrentPoint] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [hoveredWindow, setHoveredWindow] = useState<SelectionBounds | null>(
		null,
	);

	const hoverInFlight = useRef(false);
	const pendingHoverPoint = useRef<{ x: number; y: number } | null>(null);
	const lastHoverAt = useRef(0);
	const lastHoverPoint = useRef<{ x: number; y: number } | null>(null);
	const clickWindowRef = useRef<SelectionBounds | null>(null);

	useEffect(() => {
		const style = document.createElement("style");
		style.id = "overlay-transparent-override";
		style.textContent = `
			html, body, #root {
				background: transparent !important;
				background-color: transparent !important;
			}
		`;
		document.head.appendChild(style);

		window.api.send("selection-overlay:ready");

		const handleInit = (data: OverlayInitData) => {
			setDisplays(data.displays);
			setOffset(data.offset);
			setHoveredWindow(null);
		};

		const unsubscribe = window.api.on(
			"selection-overlay:init" as never,
			handleInit as never,
		);

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				window.api.send("selection-overlay:result", null);
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			style.remove();
			unsubscribe();
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const requestHover = useCallback((point: { x: number; y: number }) => {
		const now = Date.now();
		const lastPoint = lastHoverPoint.current;
		const deltaX = lastPoint ? Math.abs(point.x - lastPoint.x) : Infinity;
		const deltaY = lastPoint ? Math.abs(point.y - lastPoint.y) : Infinity;
		const distance = Math.max(deltaX, deltaY);
		if (distance < 6) return;
		if (hoverInFlight.current) {
			pendingHoverPoint.current = point;
			return;
		}
		if (now - lastHoverAt.current < 160) {
			pendingHoverPoint.current = point;
			return;
		}
		lastHoverPoint.current = point;
		hoverInFlight.current = true;
		lastHoverAt.current = now;
		window.api.send("selection-overlay:hover", point);
	}, []);

	useEffect(() => {
		const unsubscribe = window.api.on(
			"selection-overlay:hover-result" as never,
			((result: SelectionBounds | null) => {
				hoverInFlight.current = false;
				setHoveredWindow((prev) => {
					if (!prev && !result) return prev;
					if (!prev || !result) return result;
					if (
						prev.x === result.x &&
						prev.y === result.y &&
						prev.width === result.width &&
						prev.height === result.height &&
						prev.displayId === result.displayId &&
						prev.appBundleId === result.appBundleId &&
						prev.windowTitle === result.windowTitle
					)
						return prev;
					return result;
				});
				if (pendingHoverPoint.current) {
					const next = pendingHoverPoint.current;
					pendingHoverPoint.current = null;
					requestHover(next);
				}
			}) as never,
		);

		return () => {
			unsubscribe();
		};
	}, [requestHover]);

	const findDisplayAtPoint = useCallback(
		(screenX: number, screenY: number): DisplayInfo | null => {
			for (const display of displays) {
				const { x, y, width, height } = display.bounds;
				if (
					screenX >= x &&
					screenX < x + width &&
					screenY >= y &&
					screenY < y + height
				) {
					return display;
				}
			}
			let nearest: DisplayInfo | null = null;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const display of displays) {
				const { x, y, width, height } = display.bounds;
				const clampedX = Math.max(x, Math.min(screenX, x + width));
				const clampedY = Math.max(y, Math.min(screenY, y + height));
				const dx = screenX - clampedX;
				const dy = screenY - clampedY;
				const distance = dx * dx + dy * dy;
				if (distance < bestDistance) {
					bestDistance = distance;
					nearest = display;
				}
			}
			return nearest ?? null;
		},
		[displays],
	);

	const toScreenCoords = useCallback(
		(clientX: number, clientY: number) => ({
			x: clientX + offset.x,
			y: clientY + offset.y,
		}),
		[offset],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (e.button !== 0) return;
			const screen = toScreenCoords(e.clientX, e.clientY);
			setStartPoint(screen);
			setCurrentPoint(screen);
			setIsSelecting(true);
			clickWindowRef.current = hoveredWindow;
		},
		[hoveredWindow, toScreenCoords],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			const screen = toScreenCoords(e.clientX, e.clientY);
			if (isSelecting) {
				setCurrentPoint(screen);
				return;
			}
			if (
				hoveredWindow &&
				screen.x >= hoveredWindow.x &&
				screen.x <= hoveredWindow.x + hoveredWindow.width &&
				screen.y >= hoveredWindow.y &&
				screen.y <= hoveredWindow.y + hoveredWindow.height
			)
				return;
			requestHover(screen);
		},
		[hoveredWindow, isSelecting, requestHover, toScreenCoords],
	);

	const handleMouseUp = useCallback(
		(e: React.MouseEvent) => {
			if (!isSelecting || !startPoint || !currentPoint) return;

			const endScreen = toScreenCoords(e.clientX, e.clientY);

			const x = Math.min(startPoint.x, endScreen.x);
			const y = Math.min(startPoint.y, endScreen.y);
			const width = Math.abs(endScreen.x - startPoint.x);
			const height = Math.abs(endScreen.y - startPoint.y);

			const MIN_SELECTION_SIZE = 10;
			if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
				const clickWindow =
					clickWindowRef.current &&
					startPoint.x >= clickWindowRef.current.x &&
					startPoint.x <=
						clickWindowRef.current.x + clickWindowRef.current.width &&
					startPoint.y >= clickWindowRef.current.y &&
					startPoint.y <=
						clickWindowRef.current.y + clickWindowRef.current.height
						? clickWindowRef.current
						: null;
				window.api.send("selection-overlay:result", clickWindow);
				setIsSelecting(false);
				setStartPoint(null);
				setCurrentPoint(null);
				clickWindowRef.current = null;
				return;
			}

			const display = findDisplayAtPoint(x + width / 2, y + height / 2);
			if (!display) {
				window.api.send("selection-overlay:result", null);
				setIsSelecting(false);
				return;
			}

			const bounds: SelectionBounds = {
				x,
				y,
				width,
				height,
				displayId: display.id,
				scaleFactor: display.scaleFactor,
			};

			window.api.send("selection-overlay:result", bounds);
			setIsSelecting(false);
			setStartPoint(null);
			setCurrentPoint(null);
			clickWindowRef.current = null;
		},
		[isSelecting, startPoint, currentPoint, toScreenCoords, findDisplayAtPoint],
	);

	const selectionRect =
		startPoint && currentPoint
			? {
					left: Math.min(startPoint.x, currentPoint.x) - offset.x,
					top: Math.min(startPoint.y, currentPoint.y) - offset.y,
					width: Math.abs(currentPoint.x - startPoint.x),
					height: Math.abs(currentPoint.y - startPoint.y),
				}
			: null;

	const hoverRect =
		hoveredWindow && !isSelecting
			? {
					left: hoveredWindow.x - offset.x,
					top: hoveredWindow.y - offset.y,
					width: hoveredWindow.width,
					height: hoveredWindow.height,
				}
			: null;

	return (
		<div
			className="fixed inset-0 cursor-crosshair select-none overflow-hidden"
			style={{ backgroundColor: "transparent" }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
		>
			<div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 transform rounded-lg bg-black/80 px-4 py-2 text-sm text-white backdrop-blur-sm">
				Click a window or drag to select a region. Press ESC to cancel.
			</div>

			{hoverRect && (
				<>
					<div
						className="pointer-events-none absolute z-10 rounded"
						style={{
							left: hoverRect.left,
							top: hoverRect.top,
							width: hoverRect.width,
							height: hoverRect.height,
							backgroundColor: "rgba(59, 130, 246, 0.12)",
						}}
					/>
					<div
						className="pointer-events-none absolute z-20 rounded border-2 border-blue-400"
						style={{
							left: hoverRect.left,
							top: hoverRect.top,
							width: hoverRect.width,
							height: hoverRect.height,
						}}
					/>
					<div
						className="pointer-events-none absolute z-30 rounded-md bg-blue-500/90 px-2 py-1 text-xs text-white shadow-sm"
						style={{
							left: hoverRect.left + 12,
							top: hoverRect.top + 12,
						}}
					>
						Capture this window
					</div>
				</>
			)}

			{selectionRect && (
				<>
					<div
						className="pointer-events-none absolute z-10 border-2 border-blue-400"
						style={{
							left: selectionRect.left,
							top: selectionRect.top,
							width: selectionRect.width,
							height: selectionRect.height,
							boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
						}}
					/>
					<div
						className="pointer-events-none absolute z-10 rounded bg-black/70 px-2 py-1 text-xs text-white"
						style={{
							left: selectionRect.left,
							top: selectionRect.top + selectionRect.height + 8,
						}}
					>
						{Math.round(selectionRect.width)} x{" "}
						{Math.round(selectionRect.height)}
					</div>
				</>
			)}
		</div>
	);
}
