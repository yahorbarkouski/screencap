import {
	Bell,
	BookOpen,
	Briefcase,
	Clock,
	Flame,
	type LucideProps,
	TrendingUp,
} from "lucide-react";
import type { ComponentType } from "react";
import type { View } from "@/types";

export interface AppNavItem {
	id: View;
	icon: ComponentType<LucideProps>;
	label: string;
}

export const appNavItems: readonly AppNavItem[] = [
	{ id: "timeline", icon: Clock, label: "Timeline" },
	{ id: "progress", icon: TrendingUp, label: "Progress" },
	{ id: "story", icon: BookOpen, label: "Journal" },
	{ id: "projects", icon: Briefcase, label: "Projects" },
	{ id: "addictions", icon: Flame, label: "Addictions" },
	{ id: "reminders", icon: Bell, label: "Reminders" },
] as const;
