import { format } from "date-fns";
import { AppWindow, Globe, Music } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SocialSharePayload {
	imageUrl: string;
	title: string;
	timestamp: number;
	category: string | null;
	appName: string | null;
	appIconPath?: string | null;
	backgroundTitle: string | null;
	backgroundArtist?: string | null;
	backgroundImageUrl?: string | null;
	websiteUrl?: string | null;
}

function getCategoryColor(category: string | null): string {
	switch (category) {
		case "Study":
			return "#3b82f6";
		case "Work":
			return "#22c55e";
		case "Leisure":
			return "#a855f7";
		case "Chores":
			return "#f97316";
		case "Social":
			return "#ec4899";
		default:
			return "#ffffff";
	}
}

interface SocialShareCardProps {
	requestId?: string;
	payload?: SocialSharePayload;
}

export function SocialShareCard({
	requestId,
	payload: directPayload,
}: SocialShareCardProps) {
	const [fetchedPayload, setFetchedPayload] =
		useState<SocialSharePayload | null>(null);
	const [imageLoaded, setImageLoaded] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const payload = directPayload ?? fetchedPayload;
	const isPlayground = Boolean(directPayload);

	useEffect(() => {
		if (!requestId || isPlayground) return;

		const fetchData = async () => {
			try {
				const data = await window.electronAPI?.invokeSocialShareData(requestId);
				if (data) {
					setFetchedPayload(data);
				}
			} catch (error) {
				console.error("Failed to fetch social share data:", error);
			}
		};

		void fetchData();
	}, [requestId, isPlayground]);

	useEffect(() => {
		if (isPlayground) return;
		if (!payload) return;
		if (!imageLoaded) return;

		const timer = setTimeout(() => {
			if (requestId) {
				window.electronAPI?.signalSocialShareReady(requestId);
			}
		}, 100);

		return () => clearTimeout(timer);
	}, [payload, imageLoaded, requestId, isPlayground]);

	if (!payload) {
		return (
			<div className="w-[1920px] h-[1080px] bg-black flex items-center justify-center">
				<div className="text-white/50 text-lg font-medium tracking-tight">
					Loading...
				</div>
			</div>
		);
	}

	const timeText = format(new Date(payload.timestamp), "h:mm a");
	const categoryColor = getCategoryColor(payload.category);

	const hasAudio = Boolean(payload.backgroundTitle);
	const hasApp = Boolean(payload.appName);
	const hasWebsite = Boolean(payload.websiteUrl);

	return (
		<div
			ref={containerRef}
			className="relative w-[1920px] h-[1080px] overflow-hidden bg-black font-sans"
		>
			{/* Main Background Image */}
			<img
				src={payload.imageUrl}
				alt=""
				className="absolute inset-0 w-full h-full object-cover"
				onLoad={() => setImageLoaded(true)}
				onError={() => setImageLoaded(true)}
			/>

			{/* Floating Island Container */}
			<div className="absolute top-10 left-1/2 -translate-x-1/2">
				<div className="relative">
					{/* Ambient Category Glow */}
					<div
						className="absolute -inset-8 rounded-[48px] opacity-25 blur-3xl pointer-events-none"
						style={{
							background: `radial-gradient(ellipse at center, ${categoryColor}, transparent 70%)`,
						}}
					/>

					{/* Glass Surface */}
					<div
						className="relative flex items-center gap-5 px-7 py-4 rounded-[28px] overflow-hidden"
						style={{
							background: "rgba(0, 0, 0, 0.55)",
							boxShadow:
								"0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 0 rgba(255, 255, 255, 0.12), 0 25px 50px -12px rgba(0, 0, 0, 0.5)",
						}}
					>
						{/* Backdrop Blur Layer */}
						<div
							className="absolute inset-0 -z-10"
							style={{
								backdropFilter: "blur(40px) saturate(150%)",
								WebkitBackdropFilter: "blur(40px) saturate(150%)",
							}}
						/>

						{/* Content Row */}
						<div className="flex items-center gap-5">
							{/* Category Badge */}
							{payload.category && (
								<div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/[0.06] border border-white/[0.08]">
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{
											backgroundColor: categoryColor,
											boxShadow: `0 0 8px ${categoryColor}60`,
										}}
									/>
									<span className="text-[15px] font-medium text-white/90 leading-none">
										{payload.category}
									</span>
								</div>
							)}

							{/* Title */}
							<div
								className="text-[22px] font-semibold tracking-tight leading-none max-w-[600px] truncate"
								style={{
									color: "rgba(255, 255, 255, 0.95)",
								}}
							>
								{payload.title || "Screenshot"}
							</div>

							{/* Divider */}
							{(hasApp || hasAudio || hasWebsite) && (
								<div className="w-px h-5 bg-white/10" />
							)}

							{/* App */}
							{hasApp && (
								<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04]">
									{payload.appIconPath ? (
										<img
											src={payload.appIconPath}
											alt=""
											className="w-4 h-4 rounded object-cover"
										/>
									) : (
										<AppWindow className="w-4 h-4 text-white/50" />
									)}
									<span className="text-[14px] font-medium text-white/70 leading-none">
										{payload.appName}
									</span>
								</div>
							)}

							{/* Audio - Song & Artist */}
							{hasAudio && (
								<div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/[0.04]">
									{payload.backgroundImageUrl ? (
										<img
											src={payload.backgroundImageUrl}
											alt=""
											className="w-5 h-5 rounded object-cover"
										/>
									) : (
										<Music className="w-4 h-4 text-white/50" />
									)}
									<div className="flex items-center gap-1.5">
										<span className="text-[14px] font-medium text-white/80 leading-none max-w-[200px] truncate">
											{payload.backgroundTitle}
										</span>
										{payload.backgroundArtist && (
											<>
												<span className="text-white/30">·</span>
												<span className="text-[14px] text-white/50 leading-none max-w-[140px] truncate">
													{payload.backgroundArtist}
												</span>
											</>
										)}
									</div>
								</div>
							)}

							{/* Website */}
							{hasWebsite && (
								<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04]">
									<Globe className="w-4 h-4 text-white/50" />
									<span className="text-[14px] font-medium text-white/70 leading-none">
										{payload.websiteUrl}
									</span>
								</div>
							)}

							{/* Divider */}
							<div className="w-px h-5 bg-white/10" />

							{/* Time */}
							<div
								className="text-[17px] font-medium tracking-tight tabular-nums leading-none"
								style={{ color: "rgba(255, 255, 255, 0.75)" }}
							>
								{timeText}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
