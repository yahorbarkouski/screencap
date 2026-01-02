import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface CollectionEmptyStateProps {
	icon: ReactNode;
	title: string;
	description: string;
	hint?: string;
	actionLabel: string;
	onAction: () => void;
}

export function CollectionEmptyState({
	icon,
	title,
	description,
	hint,
	actionLabel,
	onAction,
}: CollectionEmptyStateProps) {
	return (
		<div className="rounded-2xl border border-border bg-card overflow-hidden">
			<div className="p-10 text-center">
				<div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/30 text-muted-foreground">
					{icon}
				</div>
				<div className="text-lg font-semibold text-foreground">{title}</div>
				<div className="mt-2 text-sm text-muted-foreground">{description}</div>
				{hint ? (
					<div className="mt-3 text-xs text-muted-foreground/80">{hint}</div>
				) : null}
				<div className="mt-6 flex justify-center">
					<Button onClick={onAction} size="sm">
						{actionLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
