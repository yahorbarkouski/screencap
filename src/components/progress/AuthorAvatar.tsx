import { cn } from "@/lib/utils";

export interface AuthorAvatarProps {
	username: string;
	isMe?: boolean;
	size?: "sm" | "md";
}

export function AuthorAvatar({
	username,
	isMe = false,
	size = "sm",
}: AuthorAvatarProps) {
	const initial = username.charAt(0).toUpperCase();

	return (
		<div
			className={cn(
				"rounded-full flex items-center justify-center font-medium shrink-0",
				size === "sm" && "h-5 w-5 text-[10px]",
				size === "md" && "h-6 w-6 text-xs",
				isMe
					? "border border-primary/40 text-primary/70 bg-transparent"
					: "bg-primary text-primary-foreground",
			)}
			title={isMe ? `${username} (you)` : username}
		>
			{initial}
		</div>
	);
}
