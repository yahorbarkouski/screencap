import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import { appNavItems } from "./navigation";

export function Sidebar() {
	const view = useAppStore((s) => s.view);
	const setView = useAppStore((s) => s.setView);

	return (
		<aside className="relative shrink-0 flex flex-col items-center bg-card/50 px-2 py-1">
			<nav className="flex flex-col gap-1">
				{appNavItems.map((item) => (
					<Tooltip key={item.id} delayDuration={100}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className={cn(
									"w-8 h-8 transition-all duration-200",
									view === item.id &&
										"bg-accent/10 text-primary hover:bg-accent/10",
								)}
								onClick={() => setView(item.id)}
							>
								<item.icon className="h-5 w-5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">{item.label}</TooltipContent>
					</Tooltip>
				))}
			</nav>

			<nav className="mt-auto flex flex-col gap-1 pb-1">
				<Tooltip delayDuration={100}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className={cn(
								"w-8 h-8 transition-all duration-200",
								view === "settings" &&
									"bg-accent/10 text-primary hover:bg-accent/10",
							)}
							onClick={() => setView("settings")}
						>
							<Settings className="h-5 w-5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Settings</TooltipContent>
				</Tooltip>
			</nav>
		</aside>
	);
}
