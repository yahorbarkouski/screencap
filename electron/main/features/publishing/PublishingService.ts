import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import FormData from "form-data";
import type { CreateShareResult, ProjectShare } from "../../../shared/types";
import { getEventById } from "../../infra/db/repositories/EventRepository";
import {
	deleteProjectShare,
	getProjectShare,
	insertProjectShare,
	updateProjectShareLastPublished,
} from "../../infra/db/repositories/ProjectShareRepository";
import { createLogger } from "../../infra/log";
import { PUBLISH_BASE_URL } from "./config";

const logger = createLogger({ scope: "PublishingService" });

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_FILE_SIZE_BYTES = 45 * 1024 * 1024;

function getHqPath(webpPath: string): string | null {
	if (!webpPath.endsWith(".webp")) return null;
	return webpPath.replace(/\.webp$/, ".hq.png");
}

function getUploadablePath(originalPath: string | null): string | null {
	if (!originalPath) return null;
	if (!existsSync(originalPath)) return null;

	const hqPath = getHqPath(originalPath);
	if (hqPath && existsSync(hqPath)) {
		const hqStats = statSync(hqPath);
		if (hqStats.size <= MAX_FILE_SIZE_BYTES) {
			logger.debug("Using HQ image", { path: hqPath, size: hqStats.size });
			return hqPath;
		}
		logger.debug("HQ image too large, falling back to WebP", {
			hqPath,
			hqSize: hqStats.size,
			limit: MAX_FILE_SIZE_BYTES,
		});
	}

	const stats = statSync(originalPath);
	if (stats.size <= MAX_FILE_SIZE_BYTES) {
		return originalPath;
	}

	logger.debug("Image too large", { path: originalPath, size: stats.size });
	return null;
}

export async function createShare(
	projectName: string,
): Promise<CreateShareResult> {
	const existing = getProjectShare(projectName);
	if (existing) {
		return {
			publicId: existing.publicId,
			writeKey: existing.writeKey,
			shareUrl: existing.shareUrl,
		};
	}

	const response = await fetch(`${PUBLISH_BASE_URL}/api/published-projects`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: projectName }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to create share: ${response.status} ${text}`);
	}

	const result = (await response.json()) as CreateShareResult;

	const share: ProjectShare = {
		projectName,
		publicId: result.publicId,
		writeKey: result.writeKey,
		shareUrl: result.shareUrl,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastPublishedAt: null,
	};

	insertProjectShare(share);
	logger.info("Created share", { projectName, publicId: result.publicId });

	return result;
}

export function getShare(projectName: string): ProjectShare | null {
	return getProjectShare(projectName);
}

export function disableShare(projectName: string): void {
	deleteProjectShare(projectName);
	logger.info("Disabled share", { projectName });
}

export async function publishEvent(eventId: string): Promise<void> {
	const event = getEventById(eventId);
	if (!event) {
		logger.warn("Event not found for publishing", { eventId });
		return;
	}

	if (!event.project) {
		logger.debug("Event has no project, skipping publish", { eventId });
		return;
	}

	const share = getProjectShare(event.project);
	if (!share) {
		logger.debug("Project has no share enabled", {
			eventId,
			project: event.project,
		});
		return;
	}

	const imagePath = getUploadablePath(event.originalPath);
	if (!imagePath) {
		logger.warn("Event image not found or too large", {
			eventId,
			originalPath: event.originalPath,
		});
		return;
	}

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			await uploadEvent({
				share,
				eventId,
				timestampMs: event.timestamp,
				caption: event.caption,
				imagePath,
			});

			updateProjectShareLastPublished(event.project, Date.now());
			logger.info("Published event", {
				eventId,
				project: event.project,
				attempt,
			});
			return;
		} catch (error) {
			logger.warn("Publish attempt failed", {
				eventId,
				attempt,
				error: String(error),
			});

			if (attempt < MAX_RETRIES) {
				await sleep(RETRY_DELAY_MS * attempt);
			}
		}
	}

	logger.error("Failed to publish event after retries", { eventId });
}

async function uploadEvent(params: {
	share: ProjectShare;
	eventId: string;
	timestampMs: number;
	caption: string | null;
	imagePath: string;
}): Promise<void> {
	const { share, eventId, timestampMs, caption, imagePath } = params;

	const ext = extname(imagePath).slice(1) || "webp";
	const mimeType =
		ext === "png"
			? "image/png"
			: ext === "jpg" || ext === "jpeg"
				? "image/jpeg"
				: "image/webp";

	const imageBuffer = readFileSync(imagePath);

	const formData = new FormData();
	formData.append("eventId", eventId);
	formData.append("timestampMs", String(timestampMs));
	if (caption) {
		formData.append("caption", caption);
	}
	formData.append("file", imageBuffer, {
		filename: `${eventId}.${ext}`,
		contentType: mimeType,
	});

	const response = await fetch(
		`${PUBLISH_BASE_URL}/api/published-projects/${share.publicId}/events`,
		{
			method: "POST",
			headers: {
				"x-write-key": share.writeKey,
				...formData.getHeaders(),
			},
			body: formData.getBuffer(),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Upload failed: ${response.status} ${text}`);
	}
}

export async function backfillEvents(
	projectName: string,
	limit: number = 50,
): Promise<number> {
	const share = getProjectShare(projectName);
	if (!share) return 0;

	const { getEvents } = await import(
		"../../infra/db/repositories/EventRepository"
	);

	const events = getEvents({
		project: projectName,
		projectProgress: true,
		dismissed: false,
		limit,
	});

	let published = 0;
	for (const event of events) {
		try {
			await publishEvent(event.id);
			published++;
		} catch (error) {
			logger.warn("Backfill event failed", {
				eventId: event.id,
				error: String(error),
			});
		}
	}

	logger.info("Backfill complete", {
		projectName,
		published,
		total: events.length,
	});
	return published;
}
