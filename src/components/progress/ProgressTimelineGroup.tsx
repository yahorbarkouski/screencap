import { useMemo } from "react";
import type { AvatarSettings, Event, GitCommit } from "@/types";
import { ProgressCard } from "./ProgressCard";
import { ProgressCommitCard } from "./ProgressCommitCard";

export type ProgressTimelineItem =
	| { kind: "event"; timestamp: number; event: Event; isMe?: boolean }
	| { kind: "commit"; timestamp: number; commit: GitCommit };

export function ProgressTimelineGroup({
	date,
	items,
	showProject = false,
	onUnmark,
	avatarSettings,
}: {
	date: string;
	items: ProgressTimelineItem[];
	showProject?: boolean;
	onUnmark?: () => void;
	avatarSettings?: AvatarSettings;
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
								onUnmark={item.event.isRemote ? undefined : onUnmark}
								isMe={item.isMe}
								avatarSettings={avatarSettings}
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
