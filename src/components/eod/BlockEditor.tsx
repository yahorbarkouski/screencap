import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, ImagePlus, Plus, X } from "lucide-react";
import {
	type KeyboardEvent,
	memo,
	type PointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { cn, formatTime } from "@/lib/utils";
import type { EodBlock, EodSection, Event } from "@/types";
import {
	createTextBlock,
	insertBlockAfter,
	primaryImagePath,
	removeBlock,
	updateBlock,
} from "./EndOfDayFlow.utils";

interface BlockEditorProps {
	section: EodSection;
	events: Event[];
	onUpdateSection: (section: EodSection) => void;
	onOpenEventPicker: (insertAfterBlockId: string) => void;
}

interface PendingFocus {
	blockId: string;
	position: "start" | "end";
}

export function BlockEditor({
	section,
	events,
	onUpdateSection,
	onOpenEventPicker,
}: BlockEditorProps) {
	const pendingFocusRef = useRef<PendingFocus | null>(null);

	const handleTextChange = useCallback(
		(blockId: string, content: string) => {
			onUpdateSection({
				...section,
				blocks: updateBlock(section.blocks, blockId, (b) =>
					b.kind === "text" ? { ...b, content } : b,
				),
			});
		},
		[section, onUpdateSection],
	);

	const focusBlock = useCallback(
		(blockId: string, position: "start" | "end") => {
			requestAnimationFrame(() => {
				const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
				if (!blockEl) return;

				const textarea = blockEl.querySelector(
					"textarea",
				) as HTMLTextAreaElement | null;
				if (textarea) {
					textarea.focus();
					const pos = position === "start" ? 0 : textarea.value.length;
					textarea.setSelectionRange(pos, pos);
				} else {
					const focusable = blockEl.querySelector(
						"[data-event-focus]",
					) as HTMLElement | null;
					focusable?.focus();
				}
			});
		},
		[],
	);

	const handleRemoveBlock = useCallback(
		(blockId: string, focusDirection: "prev" | "next" = "prev") => {
			const idx = section.blocks.findIndex((b) => b.id === blockId);
			const adjacentIdx = focusDirection === "prev" ? idx - 1 : idx + 1;
			const adjacentBlock = section.blocks[adjacentIdx];

			onUpdateSection({
				...section,
				blocks: removeBlock(section.blocks, blockId),
			});

			if (adjacentBlock) {
				const position = focusDirection === "prev" ? "end" : "start";
				focusBlock(adjacentBlock.id, position);
			}
		},
		[section, onUpdateSection, focusBlock],
	);

	const handleAddTextAfter = useCallback(
		(afterBlockId: string) => {
			const newBlock = createTextBlock();
			pendingFocusRef.current = { blockId: newBlock.id, position: "start" };
			onUpdateSection({
				...section,
				blocks: insertBlockAfter(section.blocks, afterBlockId, newBlock),
			});
		},
		[section, onUpdateSection],
	);

	const handleReorder = useCallback(
		(reordered: EodBlock[]) => {
			onUpdateSection({ ...section, blocks: reordered });
		},
		[section, onUpdateSection],
	);

	const handleMergeWithPrevious = useCallback(
		(blockId: string) => {
			const idx = section.blocks.findIndex((b) => b.id === blockId);
			if (idx <= 0) return;

			const current = section.blocks[idx];
			const prev = section.blocks[idx - 1];

			if (current.kind !== "text") return;

			if (prev.kind === "event") {
				focusBlock(prev.id, "end");
				return;
			}

			const mergedContent = prev.content + current.content;
			const cursorPosition = prev.content.length;

			const newBlocks = section.blocks
				.map((b, i) => {
					if (i === idx - 1) return { ...prev, content: mergedContent };
					return b;
				})
				.filter((_, i) => i !== idx);

			onUpdateSection({ ...section, blocks: newBlocks });

			requestAnimationFrame(() => {
				const textarea = document.querySelector(
					`[data-block-id="${prev.id}"] textarea`,
				) as HTMLTextAreaElement | null;
				if (textarea) {
					textarea.focus();
					textarea.setSelectionRange(cursorPosition, cursorPosition);
				}
			});
		},
		[section, onUpdateSection, focusBlock],
	);

	const handleSplitBlock = useCallback(
		(blockId: string, cursorPosition: number) => {
			const block = section.blocks.find((b) => b.id === blockId);
			if (!block || block.kind !== "text") return;

			const beforeContent = block.content.slice(0, cursorPosition);
			const afterContent = block.content.slice(cursorPosition);

			const newBlock = createTextBlock(afterContent);
			pendingFocusRef.current = { blockId: newBlock.id, position: "start" };

			const newBlocks = section.blocks.flatMap((b) => {
				if (b.id === blockId) {
					return [{ ...b, content: beforeContent }, newBlock];
				}
				return b;
			});

			onUpdateSection({ ...section, blocks: newBlocks });
		},
		[section, onUpdateSection],
	);

	const getAdjacentBlockId = useCallback(
		(blockId: string, direction: "prev" | "next"): string | null => {
			const idx = section.blocks.findIndex((b) => b.id === blockId);
			if (idx === -1) return null;

			const targetIdx = direction === "prev" ? idx - 1 : idx + 1;
			const target = section.blocks[targetIdx];

			return target?.id ?? null;
		},
		[section.blocks],
	);

	const eventMap = useMemo(() => {
		const map = new Map<string, Event>();
		for (const e of events) {
			map.set(e.id, e);
		}
		return map;
	}, [events]);

	return (
		<Reorder.Group
			axis="y"
			values={section.blocks}
			onReorder={handleReorder}
			className="flex flex-col py-3 px-14"
			layoutScroll
		>
			{section.blocks.map((block, index) => (
				<BlockItem
					key={block.id}
					block={block}
					eventMap={eventMap}
					isFirst={index === 0}
					isLast={index === section.blocks.length - 1}
					canRemove={section.blocks.length > 1 || block.kind === "event"}
					pendingFocusRef={pendingFocusRef}
					onTextChange={handleTextChange}
					onRemove={handleRemoveBlock}
					onAddTextAfter={handleAddTextAfter}
					onOpenEventPicker={onOpenEventPicker}
					onMergeWithPrevious={handleMergeWithPrevious}
					onSplitBlock={handleSplitBlock}
					getAdjacentBlockId={getAdjacentBlockId}
					focusBlock={focusBlock}
				/>
			))}
		</Reorder.Group>
	);
}

interface BlockItemProps {
	block: EodBlock;
	eventMap: Map<string, Event>;
	isFirst: boolean;
	isLast: boolean;
	canRemove: boolean;
	pendingFocusRef: React.MutableRefObject<PendingFocus | null>;
	onTextChange: (blockId: string, content: string) => void;
	onRemove: (blockId: string, focusDirection?: "prev" | "next") => void;
	onAddTextAfter: (afterBlockId: string) => void;
	onOpenEventPicker: (insertAfterBlockId: string) => void;
	onMergeWithPrevious: (blockId: string) => void;
	onSplitBlock: (blockId: string, cursorPosition: number) => void;
	getAdjacentBlockId: (
		blockId: string,
		direction: "prev" | "next",
	) => string | null;
	focusBlock: (blockId: string, position: "start" | "end") => void;
}

const BlockItem = memo(function BlockItem({
	block,
	eventMap,
	isFirst,
	isLast,
	canRemove,
	pendingFocusRef,
	onTextChange,
	onRemove,
	onAddTextAfter,
	onOpenEventPicker,
	onMergeWithPrevious,
	onSplitBlock,
	getAdjacentBlockId,
	focusBlock,
}: BlockItemProps) {
	const controls = useDragControls();

	const handleDragStart = useCallback(
		(e: PointerEvent) => {
			controls.start(e);
		},
		[controls],
	);

	if (block.kind === "text") {
		return (
			<TextBlock
				block={block}
				isFirst={isFirst}
				canRemove={canRemove}
				pendingFocusRef={pendingFocusRef}
				dragControls={controls}
				onDragStart={handleDragStart}
				onTextChange={onTextChange}
				onRemove={onRemove}
				onOpenEventPicker={onOpenEventPicker}
				onMergeWithPrevious={onMergeWithPrevious}
				onSplitBlock={onSplitBlock}
				getAdjacentBlockId={getAdjacentBlockId}
				focusBlock={focusBlock}
			/>
		);
	}

	const event = eventMap.get(block.eventId) ?? null;
	return (
		<EventBlock
			block={block}
			event={event}
			isLast={isLast}
			pendingFocusRef={pendingFocusRef}
			dragControls={controls}
			onDragStart={handleDragStart}
			onRemove={onRemove}
			onAddTextAfter={onAddTextAfter}
			onOpenEventPicker={onOpenEventPicker}
			getAdjacentBlockId={getAdjacentBlockId}
			focusBlock={focusBlock}
		/>
	);
});

interface TextBlockProps {
	block: Extract<EodBlock, { kind: "text" }>;
	isFirst: boolean;
	canRemove: boolean;
	pendingFocusRef: React.MutableRefObject<PendingFocus | null>;
	dragControls: ReturnType<typeof useDragControls>;
	onDragStart: (e: PointerEvent) => void;
	onTextChange: (blockId: string, content: string) => void;
	onRemove: (blockId: string, focusDirection?: "prev" | "next") => void;
	onOpenEventPicker: (insertAfterBlockId: string) => void;
	onMergeWithPrevious: (blockId: string) => void;
	onSplitBlock: (blockId: string, cursorPosition: number) => void;
	getAdjacentBlockId: (
		blockId: string,
		direction: "prev" | "next",
	) => string | null;
	focusBlock: (blockId: string, position: "start" | "end") => void;
}

const TextBlock = memo(function TextBlock({
	block,
	isFirst,
	canRemove,
	pendingFocusRef,
	dragControls,
	onDragStart,
	onTextChange,
	onRemove,
	onOpenEventPicker,
	onMergeWithPrevious,
	onSplitBlock,
	getAdjacentBlockId,
	focusBlock,
}: TextBlockProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "0";
		textarea.style.height = `${Math.max(textarea.scrollHeight, 28)}px`;
	});

	useEffect(() => {
		if (pendingFocusRef.current?.blockId === block.id) {
			const position = pendingFocusRef.current.position;
			pendingFocusRef.current = null;
			const textarea = textareaRef.current;
			if (textarea) {
				textarea.focus();
				const pos = position === "end" ? textarea.value.length : 0;
				textarea.setSelectionRange(pos, pos);
			}
		}
	}, [block.id, pendingFocusRef]);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			onTextChange(block.id, e.target.value);
		},
		[block.id, onTextChange],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			const textarea = e.currentTarget;
			const { selectionStart, selectionEnd, value } = textarea;
			const hasSelection = selectionStart !== selectionEnd;

			if (e.key === "Backspace" && selectionStart === 0 && !hasSelection) {
				if (value === "" && canRemove) {
					e.preventDefault();
					onRemove(block.id, "prev");
					return;
				}
				e.preventDefault();
				onMergeWithPrevious(block.id);
				return;
			}

			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				onSplitBlock(block.id, selectionStart);
				return;
			}

			if (e.key === "ArrowUp" && selectionStart === 0 && !hasSelection) {
				const prevId = getAdjacentBlockId(block.id, "prev");
				if (prevId) {
					e.preventDefault();
					focusBlock(prevId, "end");
				}
				return;
			}

			if (
				e.key === "ArrowDown" &&
				selectionStart === value.length &&
				!hasSelection
			) {
				const nextId = getAdjacentBlockId(block.id, "next");
				if (nextId) {
					e.preventDefault();
					focusBlock(nextId, "start");
				}
			}
		},
		[
			block.id,
			canRemove,
			onRemove,
			onMergeWithPrevious,
			onSplitBlock,
			getAdjacentBlockId,
			focusBlock,
		],
	);

	return (
		<Reorder.Item
			value={block}
			dragListener={false}
			dragControls={dragControls}
			data-block-id={block.id}
			className="group relative"
			initial={{ opacity: 0, height: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			exit={{ opacity: 0, height: 0 }}
			transition={{ duration: 0.15 }}
		>
			<div className="absolute -left-12 top-[7px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
					onPointerDown={onDragStart}
					title="Drag to reorder"
				>
					<GripVertical className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
					onClick={() => onOpenEventPicker(block.id)}
					title="Insert event"
				>
					<ImagePlus className="h-3.5 w-3.5" />
				</button>
			</div>

			<textarea
				ref={textareaRef}
				value={block.content}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				placeholder={isFirst ? "Write something..." : "Continue writing..."}
				className="w-full resize-none border-none bg-transparent text-base leading-relaxed focus:outline-none focus-visible:ring-0 min-h-[28px] overflow-hidden py-0.5"
				rows={1}
			/>

			{canRemove && (
				<button
					type="button"
					className="absolute -right-7 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground/50 hover:text-destructive"
					onClick={() => onRemove(block.id)}
					title="Remove block"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</Reorder.Item>
	);
});

interface EventBlockProps {
	block: Extract<EodBlock, { kind: "event" }>;
	event: Event | null;
	isLast: boolean;
	pendingFocusRef: React.MutableRefObject<PendingFocus | null>;
	dragControls: ReturnType<typeof useDragControls>;
	onDragStart: (e: PointerEvent) => void;
	onRemove: (blockId: string, focusDirection?: "prev" | "next") => void;
	onAddTextAfter: (afterBlockId: string) => void;
	onOpenEventPicker: (insertAfterBlockId: string) => void;
	getAdjacentBlockId: (
		blockId: string,
		direction: "prev" | "next",
	) => string | null;
	focusBlock: (blockId: string, position: "start" | "end") => void;
}

const EventBlock = memo(function EventBlock({
	block,
	event,
	isLast,
	pendingFocusRef,
	dragControls,
	onDragStart,
	onRemove,
	onAddTextAfter,
	onOpenEventPicker,
	getAdjacentBlockId,
	focusBlock,
}: EventBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const img = event ? primaryImagePath(event) : null;

	useEffect(() => {
		if (pendingFocusRef.current?.blockId === block.id) {
			pendingFocusRef.current = null;
			containerRef.current?.focus();
		}
	}, [block.id, pendingFocusRef]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "Backspace" || e.key === "Delete") {
				e.preventDefault();
				onRemove(block.id, isLast ? "prev" : "next");
				return;
			}

			if (e.key === "ArrowUp") {
				const prevId = getAdjacentBlockId(block.id, "prev");
				if (prevId) {
					e.preventDefault();
					focusBlock(prevId, "end");
				}
				return;
			}

			if (e.key === "ArrowDown") {
				const nextId = getAdjacentBlockId(block.id, "next");
				if (nextId) {
					e.preventDefault();
					focusBlock(nextId, "start");
				}
				return;
			}

			if (e.key === "Enter") {
				e.preventDefault();
				onAddTextAfter(block.id);
			}
		},
		[
			block.id,
			isLast,
			onRemove,
			onAddTextAfter,
			getAdjacentBlockId,
			focusBlock,
		],
	);

	return (
		<Reorder.Item
			value={block}
			dragListener={false}
			dragControls={dragControls}
			data-block-id={block.id}
			className="group relative my-0"
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.95 }}
			transition={{ duration: 0.15 }}
		>
			<div className="absolute -left-10 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
					onPointerDown={onDragStart}
					title="Drag to reorder"
				>
					<GripVertical className="h-3.5 w-3.5" />
				</button>
			</div>

			{/* biome-ignore lint/a11y/useSemanticElements: complex layout requires div with keyboard nav */}
			<div
				ref={containerRef}
				role="button"
				data-event-focus
				tabIndex={0}
				onKeyDown={handleKeyDown}
				className={cn(
					"flex items-start gap-3 p-2 rounded-lg border bg-muted/20 transition-all cursor-pointer outline-none",
					"border-border/50 hover:border-border",
					"focus:border-primary/60 focus:ring-2 focus:ring-primary/20",
				)}
			>
				<div className="w-1/2 shrink-0 aspect-video rounded-md overflow-hidden bg-muted/40">
					{img ? (
						<img
							alt=""
							src={`local-file://${img}`}
							className="w-full h-full object-cover"
							loading="lazy"
						/>
					) : (
						<div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
							No image
						</div>
					)}
				</div>
				<div className="flex-1 min-w-0 py-0.5">
					<div className="text-xs text-muted-foreground">
						{event ? formatTime(event.timestamp) : "Unknown event"}
					</div>
					<div className="text-sm font-medium truncate">
						{event?.caption ?? event?.appName ?? "—"}
					</div>
					{event?.project && (
						<div className="text-xs text-muted-foreground truncate">
							{event.project}
						</div>
					)}
				</div>
			</div>

			<div className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col gap-0.5">
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
					onClick={() => onAddTextAfter(block.id)}
					title="Add text after"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
					onClick={() => onOpenEventPicker(block.id)}
					title="Insert event"
				>
					<ImagePlus className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					className="p-0.5 text-muted-foreground/50 hover:text-destructive"
					onClick={() => onRemove(block.id)}
					title="Remove event"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</Reorder.Item>
	);
});
