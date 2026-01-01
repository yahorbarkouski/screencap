import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopCapturer, screen } from "electron";
import sharp from "sharp";
import { v4 as uuid } from "uuid";
import type { CaptureResult } from "../../../shared/types";
import { createLogger } from "../../infra/log";
import { getOriginalsDir, getThumbnailsDir } from "../../infra/paths";
import { computeFingerprint } from "./FingerprintService";

const logger = createLogger({ scope: "CaptureService" });

const THUMBNAIL_WIDTH = 400;
const ORIGINAL_WIDTH = 1280;
const WEBP_QUALITY = 80;
const HIGH_RES_SUFFIX = ".hq.png";

function bestThumbnailSize(): { width: number; height: number } {
	const displays = screen.getAllDisplays();
	let maxWidth = 0;
	let maxHeight = 0;

	for (const d of displays) {
		const w = Math.round(d.size.width * (d.scaleFactor ?? 1));
		const h = Math.round(d.size.height * (d.scaleFactor ?? 1));
		if (w > maxWidth) maxWidth = w;
		if (h > maxHeight) maxHeight = h;
	}

	if (maxWidth <= 0 || maxHeight <= 0) return { width: 1920, height: 1080 };
	return { width: maxWidth, height: maxHeight };
}

function highResPathForId(id: string, originalsDir: string): string {
	return join(originalsDir, `${id}${HIGH_RES_SUFFIX}`);
}

export async function captureAllDisplays(options?: {
	highResDisplayId?: string | null;
	dirs?: { thumbnailsDir: string; originalsDir: string };
}): Promise<CaptureResult[]> {
	logger.info("Capturing all displays...");

	const highResDisplayId = options?.highResDisplayId ?? null;
	const thumbnailsDir = options?.dirs?.thumbnailsDir ?? getThumbnailsDir();
	const originalsDir = options?.dirs?.originalsDir ?? getOriginalsDir();
	const displays = screen.getAllDisplays();
	logger.debug(`Found ${displays.length} displays`);

	const results: CaptureResult[] = [];
	const timestamp = Date.now();

	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: bestThumbnailSize(),
	});

	logger.debug(`Got ${sources.length} screen sources`);

	for (const source of sources) {
		logger.debug(
			`Processing source: ${source.name}, display_id: ${source.display_id}`,
		);

		const display = displays.find((d) => source.display_id === String(d.id));

		const id = uuid();
		const thumbnailPath = join(thumbnailsDir, `${id}.webp`);
		const originalPath = join(originalsDir, `${id}.webp`);
		const highResPath = highResPathForId(id, originalsDir);

		const nativeImage = source.thumbnail;
		if (nativeImage.isEmpty()) {
			logger.warn("Native image is empty - permission might be denied");
			continue;
		}

		const pngBuffer = nativeImage.toPNG();
		logger.debug(`PNG buffer size: ${pngBuffer.length} bytes`);

		if (highResDisplayId && source.display_id === highResDisplayId) {
			writeFileSync(highResPath, pngBuffer);
		}

		const original = await sharp(pngBuffer)
			.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();

		const thumbnail = await sharp(pngBuffer)
			.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();

		const fingerprint = await computeFingerprint(original);

		writeFileSync(originalPath, original);
		writeFileSync(thumbnailPath, thumbnail);

		logger.debug("Saved files:", {
			originalPath,
			thumbnailPath,
			originalSize: original.length,
			thumbnailSize: thumbnail.length,
		});

		results.push({
			id,
			timestamp,
			displayId: source.display_id,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: display?.size.width ?? 1920,
			height: display?.size.height ?? 1080,
		});
	}

	logger.info(`Capture complete: ${results.length} results`);
	return results;
}

export async function captureForClassification(): Promise<Buffer | null> {
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: bestThumbnailSize(),
	});

	if (sources.length === 0) {
		logger.warn("No sources available for classification capture");
		return null;
	}

	const primarySource = sources[0];
	const nativeImage = primarySource.thumbnail;

	if (nativeImage.isEmpty()) {
		logger.warn("Classification capture: image is empty");
		return null;
	}

	const pngBuffer = nativeImage.toPNG();

	const resized = await sharp(pngBuffer)
		.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer();

	return resized;
}
