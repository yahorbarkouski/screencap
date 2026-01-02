import { Briefcase, Calendar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { ProjectStats } from "@/hooks/useProjectStats";
import { formatRelativeTime } from "@/lib/utils";
import type { Memory } from "@/types";

interface ProjectCardProps {
	project: Memory;
	stats?: ProjectStats;
	onClick: () => void;
}

export function ProjectCard({ project, stats, onClick }: ProjectCardProps) {
	const candidates = useMemo(
		() => stats?.coverCandidates ?? [],
		[stats?.coverCandidates],
	);
	const [idx, setIdx] = useState(0);
	const firstCandidate = candidates[0] ?? null;

	useEffect(() => {
		setIdx(0);
		if (!firstCandidate) return;
	}, [firstCandidate]);

	const imagePath = candidates[idx] ?? null;

	return (
		<button
			type="button"
			className="group text-left w-full h-full rounded-xl border border-border bg-card overflow-hidden transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col"
			onClick={onClick}
		>
			<div className="relative aspect-[4/3] bg-muted shrink-0 overflow-hidden">
				{imagePath ? (
					<img
						src={`local-file://${imagePath}`}
						alt=""
						className="w-full h-full object-cover"
						loading="lazy"
						draggable={false}
						onError={() => {
							setIdx((v) => (v + 1 < candidates.length ? v + 1 : v));
						}}
					/>
				) : (
					<div />
				)}

				{stats?.eventCount ? (
					<div className="absolute top-3 right-3">
						<Badge
							variant="secondary"
							className="bg-black/60 backdrop-blur-md border border-white/10 text-white font-medium"
						>
							<Calendar className="w-3 h-3 mr-1.5 opacity-80" />
							{stats.eventCount}
						</Badge>
					</div>
				) : null}
			</div>

			<div className="p-5 flex flex-col flex-1 gap-2">
				<h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors line-clamp-1 min-h-[1.75rem]">
					{project.content}
				</h3>

				{project.description ? (
					<p className="text-sm text-muted-foreground line-clamp-2 leading-snug min-h-[2.5rem]">
						{project.description}
					</p>
				) : (
					<p className="text-sm text-muted-foreground/50 italic min-h-[2.5rem] leading-snug">
						No description
					</p>
				)}

				<div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground">
					<Briefcase className="w-3.5 h-3.5" />
					<span>
						{stats?.lastEventAt
							? `Last activity ${formatRelativeTime(stats.lastEventAt)}`
							: "No activity yet"}
					</span>
				</div>
			</div>
		</button>
	);
}
