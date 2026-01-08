import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const TRANSITION_EASE = [0.25, 0.1, 0.25, 1] as const;
export const NOTES_SURFACE =
	"rounded-[28px] border border-zinc-800 bg-zinc-950/70 shadow-[0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden";
export const NOTES_RULED =
	"bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:100%_28px]";

interface FadeInProps {
	children: React.ReactNode;
	delay?: number;
	className?: string;
}

export function FadeIn({ children, delay = 0, className = "" }: FadeInProps) {
	return (
		<motion.div
			initial={{ opacity: 0, filter: "blur(6px)", y: 8 }}
			animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
			exit={{ opacity: 0, filter: "blur(6px)", y: -8 }}
			transition={{ duration: 0.18, ease: TRANSITION_EASE, delay }}
			className={className}
		>
			{children}
		</motion.div>
	);
}

interface ButtonProps {
	children: React.ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}

export function PrimaryButton({
	children,
	onClick,
	disabled,
	className = "",
}: ButtonProps) {
	return (
		<motion.button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
				"border-zinc-800 bg-black/90 text-zinc-200 hover:bg-zinc-950/60 hover:border-yellow-500/40 hover:text-white",
				"disabled:opacity-50 disabled:pointer-events-none",
				className,
			)}
			whileHover={{
				textShadow:
					"0 0 10px rgba(255, 215, 0, 0.55), 0 0 18px rgba(255, 215, 0, 0.25)",
				boxShadow:
					"0 0 0 1px rgba(255, 215, 0, 0.06), 0 0 18px rgba(255, 215, 0, 0.10)",
			}}
			whileTap={{ scale: 0.99 }}
			transition={{ duration: 0.18 }}
		>
			{children}
		</motion.button>
	);
}

export function GhostButton({
	children,
	onClick,
	disabled,
	className = "",
}: ButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors",
				"border-zinc-800 bg-black text-zinc-400 hover:text-white hover:border-zinc-700",
				"disabled:opacity-50 disabled:pointer-events-none",
				className,
			)}
		>
			{children}
		</button>
	);
}

interface BottomActionsProps {
	left: React.ReactNode;
	right: React.ReactNode;
}

export function BottomActions({ left, right }: BottomActionsProps) {
	return (
		<div className="fixed bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
			<div className="pointer-events-auto flex items-center justify-center gap-2">
				{left}
				{right}
			</div>
		</div>
	);
}

interface KpiProps {
	label: string;
	value: string;
	detail?: string;
	delta?: string;
	deltaTone?: "up" | "down" | "neutral";
}

export function Kpi({ label, value, detail, delta, deltaTone }: KpiProps) {
	return (
		<div className="rounded-lg border border-border bg-background/30 px-4 py-3">
			<div className="flex items-center justify-between gap-2">
				<div className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">
					{label.toUpperCase()}
				</div>
				{delta ? (
					<div
						className={cn(
							"font-mono text-[10px] tracking-[0.18em]",
							deltaTone === "up"
								? "text-green-400"
								: deltaTone === "down"
									? "text-red-400"
									: "text-muted-foreground",
						)}
					>
						{delta}
					</div>
				) : null}
			</div>
			<div className="mt-1 text-2xl font-semibold leading-none">{value}</div>
			{detail ? (
				<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
			) : null}
		</div>
	);
}

type StampTone = "good" | "warn" | "bad" | "neutral";

interface StampProps {
	tone: StampTone;
	title: string;
	detail: string;
}

const STAMP_CONFIG: Record<
	StampTone,
	{ bg: string; border: string; text: string; glow: string }
> = {
	good: {
		bg: "bg-green-500/10",
		border: "border-green-500/20",
		text: "text-green-400",
		glow: "shadow-[0_0_20px_rgba(34,197,94,0.12)]",
	},
	warn: {
		bg: "bg-amber-500/10",
		border: "border-amber-500/25",
		text: "text-amber-400",
		glow: "shadow-[0_0_20px_rgba(245,158,11,0.12)]",
	},
	bad: {
		bg: "bg-red-500/10",
		border: "border-red-500/25",
		text: "text-red-400",
		glow: "shadow-[0_0_20px_rgba(239,68,68,0.12)]",
	},
	neutral: {
		bg: "bg-zinc-500/10",
		border: "border-zinc-500/20",
		text: "text-zinc-400",
		glow: "shadow-[0_0_20px_rgba(113,113,122,0.08)]",
	},
};

export function Stamp({ tone, title, detail }: StampProps) {
	const cfg = STAMP_CONFIG[tone];
	return (
		<motion.div
			initial={{ scale: 0.97, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 22 }}
			className={cn(
				"rounded-xl border px-4 py-3 backdrop-blur-sm",
				cfg.bg,
				cfg.border,
				cfg.glow,
			)}
		>
			<div className={cn("text-sm font-medium", cfg.text)}>{title}</div>
			<div className="mt-1 text-xs text-muted-foreground">{detail}</div>
		</motion.div>
	);
}
