import { ArrowBigUp, Command } from "lucide-react";
import type { HTMLAttributes } from "react";
import { tokenizeAccelerator } from "@/lib/accelerator";
import { cn } from "@/lib/utils";

type ShortcutKbdProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
	accelerator: string | null | undefined;
};

const ICON_SIZE = 12;
const ICON_STROKE = 2.5;

export function ShortcutKbd({
	accelerator,
	className,
	...props
}: ShortcutKbdProps) {
	const result = tokenizeAccelerator(accelerator);
	if (!result) return null;

	const { mac, tokens } = result;

	return (
		<div
			className={cn(
				"pointer-events-none inline-flex shrink-0 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground",
				className,
			)}
			{...props}
		>
			{tokens.map((token) => {
				const key = `${token.type}-${token.label}`;
				if (mac && token.type === "command") {
					return (
						<Command
							key={key}
							size={ICON_SIZE}
							strokeWidth={ICON_STROKE}
							className="shrink-0"
						/>
					);
				}
				if (mac && token.type === "shift") {
					return (
						<ArrowBigUp
							key={key}
							size={ICON_SIZE}
							strokeWidth={ICON_STROKE}
							className="shrink-0"
						/>
					);
				}
				if (token.label) {
					return <span key={key}>{token.label}</span>;
				}
				return null;
			})}
		</div>
	);
}
