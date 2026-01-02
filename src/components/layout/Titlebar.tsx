import { Github, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortcutKbd } from "@/components/ui/shortcut-kbd";
import { isMac } from "@/lib/accelerator";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";

export function Titlebar() {
	const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
	const mac = isMac();

	return (
		<header
			className={cn(
				"drag-region flex pt-1.5 items-center bg-card/50 text-foreground",
				mac ? "pl-[48px]" : "",
			)}
		>
			<div className="grid w-full grid-cols-[1fr,minmax(0,420px),1fr] items-center gap-3 pb-1.5 pr-1.5">
				<div className="h-7" />

				<button
					type="button"
					className="no-drag group flex h-7 w-full items-center gap-1 rounded-md border border-input bg-background/30 px-2 pr-1 text-xs text-muted-foreground transition-colors hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => setCommandPaletteOpen(true)}
				>
					<Search className="size-3.5 text-muted-foreground" />
					<span className="flex-1 text-left">Search</span>
					<ShortcutKbd
						accelerator="CommandOrControl+K"
						className="px-2 text-xs text-foreground/70"
					/>
				</button>

				<div className="flex items-center justify-end gap-1">
					<Button
						aria-label="Open GitHub"
						variant="ghost"
						size="icon"
						className="no-drag size-7"
						onClick={() =>
							void window.api.app.openExternal(
								"https://github.com/yahorbarkouski/screencap",
							)
						}
					>
						<Github className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</header>
	);
}
