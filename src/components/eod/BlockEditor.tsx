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
import { cn } from "@/lib/utils";
import type { EodBlock, EodSection, Event } from "@/types";
import {
	createTextBlock,
	insertBlockAfter,
	removeBlock,
	updateBlock,
} from "./EndOfDayFlow.utils";
import { EventCard } from "./EventCard";

const LIST_BULLET = "•";

type ListPrefix =
	| {
			kind: "bullet";
			indent: string;
			rawPrefix: string;
			normalizedPrefix: string;
	  }
	| {
			kind: "ordered";
			indent: string;
			number: number;
			rawPrefix: string;
			normalizedPrefix: string;
	  };

function getLineBounds(
	value: string,
	pos: number,
): {
	start: number;
	end: number;
	line: string;
} {
	const start = value.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
	const nextNewline = value.indexOf("\n", start);
	const end = nextNewline === -1 ? value.length : nextNewline;
	return { start, end, line: value.slice(start, end) };
}

function getPreviousLine(
	value: string,
	lineStart: number,
): {
	start: number;
	end: number;
	line: string;
} | null {
	const prevEnd = lineStart - 1;
	if (prevEnd < 0) return null;
	const start = value.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
	return { start, end: prevEnd, line: value.slice(start, prevEnd) };
}

function parseListPrefix(line: string): ListPrefix | null {
	const bullet = line.match(/^(\s*)(?:[-*]|[•●])\s+/);
	if (bullet) {
		const indent = bullet[1];
		const rawPrefix = bullet[0];
		return {
			kind: "bullet",
			indent,
			rawPrefix,
			normalizedPrefix: `${indent}${LIST_BULLET} `,
		};
	}

	const ordered = line.match(/^(\s*)(\d+)[.)]\s+/);
	if (ordered) {
		const indent = ordered[1];
		const rawPrefix = ordered[0];
		const number = Number.parseInt(ordered[2], 10);
		if (!Number.isFinite(number)) return null;
		return {
			kind: "ordered",
			indent,
			number,
			rawPrefix,
			normalizedPrefix: `${indent}${number}. `,
		};
	}

	return null;
}

function normalizeListPrefixAtLine(
	value: string,
	lineStart: number,
	cursor: number,
	prefix: ListPrefix,
): { value: string; cursor: number; prefix: ListPrefix } {
	if (prefix.rawPrefix === prefix.normalizedPrefix) {
		return { value, cursor, prefix };
	}

	const newValue =
		value.slice(0, lineStart) +
		prefix.normalizedPrefix +
		value.slice(lineStart + prefix.rawPrefix.length);

	let newCursor = cursor;
	if (cursor >= lineStart + prefix.rawPrefix.length) {
		newCursor += prefix.normalizedPrefix.length - prefix.rawPrefix.length;
	} else if (cursor > lineStart) {
		newCursor = Math.min(
			lineStart + prefix.normalizedPrefix.length,
			lineStart + Math.max(0, cursor - lineStart),
		);
	}

	const normalizedPrefix: ListPrefix = {
		...prefix,
		rawPrefix: prefix.normalizedPrefix,
	};

	return { value: newValue, cursor: newCursor, prefix: normalizedPrefix };
}

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
					nextBlockKind={section.blocks[index + 1]?.kind ?? null}
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
	nextBlockKind: "text" | "event" | null;
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
	nextBlockKind,
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
			nextBlockKind={nextBlockKind}
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
			const textarea = e.target;
			const value = textarea.value;
			const cursor = textarea.selectionStart;

			const { start, line } = getLineBounds(value, cursor);
			const prefix = parseListPrefix(line);
			if (!prefix) {
				onTextChange(block.id, value);
				return;
			}

			const normalized = normalizeListPrefixAtLine(
				value,
				start,
				cursor,
				prefix,
			);
			onTextChange(block.id, normalized.value);
			if (normalized.cursor !== cursor) {
				requestAnimationFrame(() => {
					textarea.setSelectionRange(normalized.cursor, normalized.cursor);
				});
			}
		},
		[block.id, onTextChange],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			const textarea = e.currentTarget;
			const { selectionStart, selectionEnd } = textarea;
			const hasSelection = selectionStart !== selectionEnd;
			let value = textarea.value;
			let cursor = selectionStart;

			if (hasSelection) {
				value = value.slice(0, selectionStart) + value.slice(selectionEnd);
			}

			if (e.key === "Backspace" && !hasSelection) {
				if (cursor === 0) {
					if (value === "" && canRemove) {
						e.preventDefault();
						onRemove(block.id, "prev");
						return;
					}
					e.preventDefault();
					onMergeWithPrevious(block.id);
					return;
				}

				const bounds = getLineBounds(value, cursor);
				const prefix = parseListPrefix(bounds.line);
				if (prefix) {
					const normalized = normalizeListPrefixAtLine(
						value,
						bounds.start,
						cursor,
						prefix,
					);
					value = normalized.value;
					cursor = normalized.cursor;

					if (
						cursor ===
						bounds.start + normalized.prefix.normalizedPrefix.length
					) {
						e.preventDefault();
						const newValue =
							value.slice(0, bounds.start) +
							value.slice(
								bounds.start + normalized.prefix.normalizedPrefix.length,
							);
						onTextChange(block.id, newValue);
						requestAnimationFrame(() => {
							textarea.setSelectionRange(bounds.start, bounds.start);
						});
						return;
					}
				}
			}

			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();

				const bounds = getLineBounds(value, cursor);
				const prefix = parseListPrefix(bounds.line);
				if (prefix) {
					const normalized = normalizeListPrefixAtLine(
						value,
						bounds.start,
						cursor,
						prefix,
					);
					value = normalized.value;
					cursor = normalized.cursor;

					const refreshed = getLineBounds(value, cursor);
					const afterPrefix = refreshed.line.slice(
						normalized.prefix.normalizedPrefix.length,
					);
					const isEmptyItem = afterPrefix.trim() === "";

					if (isEmptyItem) {
						const prev = getPreviousLine(value, refreshed.start);
						const prevPrefix = prev ? parseListPrefix(prev.line) : null;
						const hasPrevListItem =
							prevPrefix && prevPrefix.kind === normalized.prefix.kind;

						if (hasPrevListItem) {
							const removed =
								value.slice(0, refreshed.start) +
								value.slice(
									refreshed.start + normalized.prefix.normalizedPrefix.length,
								);
							const removedCursor =
								cursor - normalized.prefix.normalizedPrefix.length;
							const newValue =
								removed.slice(0, removedCursor) +
								"\n" +
								removed.slice(removedCursor);
							const newCursor = removedCursor + 1;
							onTextChange(block.id, newValue);
							requestAnimationFrame(() => {
								textarea.setSelectionRange(newCursor, newCursor);
							});
							return;
						}
					}

					const nextPrefix =
						normalized.prefix.kind === "ordered"
							? `${normalized.prefix.indent}${normalized.prefix.number + 1}. `
							: normalized.prefix.normalizedPrefix;

					const newValue = `${value.slice(0, cursor)}\n${nextPrefix}${value.slice(cursor)}`;
					const newCursor = cursor + 1 + nextPrefix.length;
					onTextChange(block.id, newValue);
					requestAnimationFrame(() => {
						textarea.setSelectionRange(newCursor, newCursor);
					});
					return;
				}

				onSplitBlock(block.id, cursor);
				return;
			}

			if (e.key === "Tab") {
				const bounds = getLineBounds(value, cursor);
				const prefix = parseListPrefix(bounds.line);
				if (!prefix) return;

				e.preventDefault();
				const indentUnit = "  ";

				if (e.shiftKey) {
					const removable = value.slice(
						bounds.start,
						bounds.start + indentUnit.length,
					);
					if (removable === indentUnit) {
						const newValue =
							value.slice(0, bounds.start) +
							value.slice(bounds.start + indentUnit.length);
						const newCursor = Math.max(
							bounds.start,
							cursor - indentUnit.length,
						);
						onTextChange(block.id, newValue);
						requestAnimationFrame(() => {
							textarea.setSelectionRange(newCursor, newCursor);
						});
					}
					return;
				}

				const newValue =
					value.slice(0, bounds.start) + indentUnit + value.slice(bounds.start);
				const newCursor = cursor + indentUnit.length;
				onTextChange(block.id, newValue);
				requestAnimationFrame(() => {
					textarea.setSelectionRange(newCursor, newCursor);
				});
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
			onTextChange,
			getAdjacentBlockId,
			focusBlock,
		],
	);

	return (
		<Reorder.Item
			value={block}
			dragListener={false}
			dragControls={dragControls}
			layout="position"
			transition={{ layout: { duration: 0.08, ease: "easeOut" } }}
			data-block-id={block.id}
			className="group relative px-0.5"
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
				className={cn(
					"w-full resize-none border-none bg-transparent text-base leading-relaxed focus:outline-none focus-visible:ring-0 min-h-[28px] overflow-hidden py-0.5",
					!isFirst &&
						"placeholder:text-transparent group-hover:placeholder:text-muted-foreground/50 focus:placeholder:text-muted-foreground/50",
				)}
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
	nextBlockKind: "text" | "event" | null;
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
	nextBlockKind,
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
			layout="position"
			transition={{ layout: { duration: 0.08, ease: "easeOut" } }}
			data-block-id={block.id}
			className={cn(
				"group relative my-0",
				nextBlockKind === "text" || nextBlockKind === null ? "pb-8" : "pb-2",
			)}
		>
			<div className="absolute -left-10 top-4 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
			>
				<EventCard
					event={event}
					className="transition-all cursor-pointer outline-none hover:border-border focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
				/>
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
