import { useEffect, useMemo, useState } from "react";
import { generateAvatarDataUrl, getDefaultAvatarSettings } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { AvatarSettings } from "@/types";

export interface AuthorAvatarProps {
	username: string;
	isMe?: boolean;
	size?: "sm" | "md" | "lg" | "xl";
	avatarSettings?: AvatarSettings;
}

const SIZE_MAP = {
	sm: { container: "h-5 w-5", px: 20 },
	md: { container: "h-6 w-6", px: 24 },
	lg: { container: "h-9 w-9", px: 36 },
	xl: { container: "h-12 w-12", px: 48 },
};

export function AuthorAvatar({
	username,
	isMe = false,
	size = "sm",
	avatarSettings,
}: AuthorAvatarProps) {
	const initial = useMemo(() => username.charAt(0).toUpperCase(), [username]);

	const settings = useMemo(
		() => avatarSettings ?? getDefaultAvatarSettings(),
		[avatarSettings],
	);

	const sizeConfig = SIZE_MAP[size];

	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

	useEffect(() => {
		if (isMe && avatarSettings) {
			const url = generateAvatarDataUrl(initial, sizeConfig.px * 2, settings);
			setAvatarUrl(url);
		} else {
			setAvatarUrl(null);
		}
	}, [initial, settings, isMe, avatarSettings, sizeConfig.px]);

	if (avatarUrl) {
		return (
			<div
				className={cn(
					"rounded-lg overflow-hidden shrink-0 border border-primary/40",
					sizeConfig.container,
				)}
				title={`${username} (you)`}
			>
				<img
					src={avatarUrl}
					alt={username}
					className="h-full w-full object-cover"
				/>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"rounded-full flex items-center justify-center font-medium shrink-0",
				size === "sm" && "text-[10px]",
				size === "md" && "text-xs",
				size === "lg" && "text-xs",
				size === "xl" && "text-lg",
				sizeConfig.container,
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
