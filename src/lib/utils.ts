import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 7) {
		return new Date(timestamp).toLocaleDateString();
	}
	if (days > 0) {
		return `${days}d ago`;
	}
	if (hours > 0) {
		return `${hours}h ago`;
	}
	if (minutes > 0) {
		return `${minutes}m ago`;
	}
	return "Just now";
}

export function formatDurationCompact(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0m";
	const minutesTotal = Math.floor(ms / 60_000);
	if (minutesTotal <= 0) return "0m";
	const days = Math.floor(minutesTotal / 1440);
	const hours = Math.floor((minutesTotal % 1440) / 60);
	const minutes = minutesTotal % 60;
	if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	return `${minutes}m`;
}

export function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

	const units = ["B", "KB", "MB", "GB", "TB"] as const;
	let value = bytes;
	let unitIndex = 0;

	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	const maximumFractionDigits =
		unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;

	return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

export function groupEventsByDate<T extends { timestamp: number }>(
	events: T[],
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	for (const event of events) {
		const date = new Date(event.timestamp);
		let key: string;

		if (date.toDateString() === today.toDateString()) {
			key = "Today";
		} else if (date.toDateString() === yesterday.toDateString()) {
			key = "Yesterday";
		} else {
			key = formatDate(event.timestamp);
		}

		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key)?.push(event);
	}

	return groups;
}

export function getCategoryColor(category: string | null): string {
	switch (category) {
		case "Study":
			return "bg-blue-500/20 text-blue-400 border-blue-500/30";
		case "Work":
			return "bg-green-500/20 text-green-400 border-green-500/30";
		case "Leisure":
			return "bg-purple-500/20 text-purple-400 border-purple-500/30";
		case "Chores":
			return "bg-orange-500/20 text-orange-400 border-orange-500/30";
		case "Social":
			return "bg-pink-500/20 text-pink-400 border-pink-500/30";
		default:
			return "bg-gray-500/20 text-gray-400 border-gray-500/30";
	}
}

export function getConfidenceColor(confidence: number | null): string {
	if (confidence === null) return "text-muted-foreground";
	if (confidence >= 0.8) return "text-green-400";
	if (confidence >= 0.5) return "text-yellow-400";
	return "text-red-400";
}

export function normalizeProjectName(name: string): string {
	return name.toLowerCase().trim();
}

export function sharedEventToEvent(se: {
	id: string;
	timestampMs: number;
	endTimestampMs?: number | null;
	category?: string | null;
	project?: string | null;
	projectProgress?: number | null;
	caption?: string | null;
	thumbnailPath?: string | null;
	originalPath?: string | null;
	appBundleId?: string | null;
	appName?: string | null;
	windowTitle?: string | null;
	contentKind?: string | null;
	contentTitle?: string | null;
	authorUserId?: string | null;
	authorUsername?: string | null;
}): {
	id: string;
	timestamp: number;
	endTimestamp: number | null;
	displayId: null;
	category: string | null;
	subcategories: null;
	project: string | null;
	projectProgress: number | null;
	projectProgressConfidence: null;
	projectProgressEvidence: null;
	tags: null;
	confidence: null;
	caption: string | null;
	trackedAddiction: null;
	addictionCandidate: null;
	addictionConfidence: null;
	addictionPrompt: null;
	thumbnailPath: string | null;
	originalPath: string | null;
	stableHash: null;
	detailHash: null;
	mergedCount: null;
	dismissed: number;
	userLabel: null;
	status: string;
	appBundleId: string | null;
	appName: string | null;
	appIconPath: null;
	windowTitle: string | null;
	urlHost: null;
	urlCanonical: null;
	faviconPath: null;
	screenshotCount: null;
	contentKind: string | null;
	contentId: null;
	contentTitle: string | null;
	isFullscreen: number;
	contextProvider: null;
	contextConfidence: null;
	contextKey: null;
	contextJson: null;
	authorUserId: string | null;
	authorUsername: string | null;
	isRemote: true;
} {
	return {
		id: se.id,
		timestamp: se.timestampMs,
		endTimestamp: se.endTimestampMs ?? null,
		displayId: null,
		category: se.category ?? null,
		subcategories: null,
		project: se.project ?? null,
		projectProgress: se.projectProgress ?? null,
		projectProgressConfidence: null,
		projectProgressEvidence: null,
		tags: null,
		confidence: null,
		caption: se.caption ?? null,
		trackedAddiction: null,
		addictionCandidate: null,
		addictionConfidence: null,
		addictionPrompt: null,
		thumbnailPath: se.thumbnailPath ?? null,
		originalPath: se.originalPath ?? null,
		stableHash: null,
		detailHash: null,
		mergedCount: null,
		dismissed: 0,
		userLabel: null,
		status: "completed",
		appBundleId: se.appBundleId ?? null,
		appName: se.appName ?? null,
		appIconPath: null,
		windowTitle: se.windowTitle ?? null,
		urlHost: null,
		urlCanonical: null,
		faviconPath: null,
		screenshotCount: null,
		contentKind: se.contentKind ?? null,
		contentId: null,
		contentTitle: se.contentTitle ?? null,
		isFullscreen: 0,
		contextProvider: null,
		contextConfidence: null,
		contextKey: null,
		contextJson: null,
		authorUserId: se.authorUserId ?? null,
		authorUsername: se.authorUsername ?? null,
		isRemote: true,
	};
}
