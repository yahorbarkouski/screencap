import { useMemo } from "react";
import type { Event, GitCommit, SharedEvent } from "@/types";
import { ProgressCard } from "./ProgressCard";
import { ProgressCommitCard } from "./ProgressCommitCard";
import { SharedProgressCard } from "./SharedProgressCard";

export type ProgressTimelineItem =
	| { kind: "event"; timestamp: number; event: Event }
	| { kind: "commit"; timestamp: number; commit: GitCommit }
	| {
			kind: "shared";
			timestamp: number;
			event: SharedEvent;
			projectName: string;
			isMe: boolean;
	  };

export function ProgressTimelineGroup({
	date,
	items,
	showProject = false,
	onUnmark,
}: {
	date: string;
	items: ProgressTimelineItem[];
	showProject?: boolean;
	onUnmark?: () => void;
}) {
	const ordered = useMemo(
		() => [...items].sort((a, b) => b.timestamp - a.timestamp),
		[items],
	);

	return (
		<div className="animate-fade-in">
			<h3 className="text-sm font-medium text-muted-foreground mb-4">{date}</h3>
			<div className="space-y-6">
				{ordered.map((item, idx) => {
					if (item.kind === "event") {
						return (
							<ProgressCard
								key={item.event.id}
								event={item.event}
								showProject={showProject}
								isLast={idx === ordered.length - 1}
								onUnmark={onUnmark}
							/>
						);
					}
					if (item.kind === "shared") {
						return (
							<SharedProgressCard
								key={item.event.id}
								event={item.event}
								showProject={showProject}
								projectName={item.projectName}
								isLast={idx === ordered.length - 1}
								isMe={item.isMe}
							/>
						);
					}
					return (
						<ProgressCommitCard
							key={`${item.commit.repoRoot}:${item.commit.sha}`}
							commit={item.commit}
							isLast={idx === ordered.length - 1}
						/>
					);
				})}
			</div>
		</div>
	);
}
