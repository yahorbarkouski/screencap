import { writeFile } from "node:fs/promises";
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

export interface RawCapture {
	id: string;
	displayId: string;
	pngBuffer: Buffer;
	width: number;
	height: number;
	timestamp: number;
}

interface CapturedSource {
	id: string;
	displayId: string;
	nativeImage: Electron.NativeImage;
	width: number;
	height: number;
}

export interface InstantCapture {
	previewBase64: string;
	sources: CapturedSource[];
	primaryDisplayId: string;
	timestamp: number;
}

const PREVIEW_WIDTH = 800;
const PREVIEW_JPEG_QUALITY = 85;

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

export async function captureInstant(
	primaryDisplayId?: string,
): Promise<InstantCapture | null> {
	const displays = screen.getAllDisplays();
	const timestamp = Date.now();

	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: bestThumbnailSize(),
	});

	const capturedSources: CapturedSource[] = [];

	for (const source of sources) {
		const nativeImage = source.thumbnail;
		if (nativeImage.isEmpty()) continue;

		const display = displays.find((d) => source.display_id === String(d.id));

		capturedSources.push({
			id: uuid(),
			displayId: source.display_id,
			nativeImage,
			width: display?.size.width ?? 1920,
			height: display?.size.height ?? 1080,
		});
	}

	if (capturedSources.length === 0) return null;

	const effectivePrimaryId =
		primaryDisplayId ?? String(screen.getPrimaryDisplay().id);
	const primary =
		capturedSources.find((s) => s.displayId === effectivePrimaryId) ??
		capturedSources[0];

	const resized = primary.nativeImage.resize({ width: PREVIEW_WIDTH });
	const previewBase64 = resized.toJPEG(PREVIEW_JPEG_QUALITY).toString("base64");

	return {
		previewBase64,
		sources: capturedSources,
		primaryDisplayId: primary.displayId,
		timestamp,
	};
}

export async function processInstantCapture(
	capture: InstantCapture,
	options?: {
		highResDisplayId?: string | null;
		dirs?: { thumbnailsDir: string; originalsDir: string };
	},
): Promise<CaptureResult[]> {
	const highResDisplayId = options?.highResDisplayId ?? null;
	const thumbnailsDir = options?.dirs?.thumbnailsDir ?? getThumbnailsDir();
	const originalsDir = options?.dirs?.originalsDir ?? getOriginalsDir();

	const results: CaptureResult[] = [];

	for (const source of capture.sources) {
		const thumbnailPath = join(thumbnailsDir, `${source.id}.webp`);
		const originalPath = join(originalsDir, `${source.id}.webp`);
		const highResPath = highResPathForId(source.id, originalsDir);

		const pngBuffer = source.nativeImage.toPNG();

		const [original, thumbnail] = await Promise.all([
			sharp(pngBuffer)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			sharp(pngBuffer)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && source.displayId === highResDisplayId) {
			writePromises.push(writeFile(highResPath, pngBuffer));
		}

		const [fingerprint] = await Promise.all([
			computeFingerprint(original),
			...writePromises,
		]);

		results.push({
			id: source.id,
			timestamp: capture.timestamp,
			displayId: source.displayId,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: source.width,
			height: source.height,
		});
	}

	return results;
}

export async function captureRawScreens(): Promise<RawCapture[]> {
	const displays = screen.getAllDisplays();
	const timestamp = Date.now();

	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: bestThumbnailSize(),
	});

	const results: RawCapture[] = [];

	for (const source of sources) {
		const nativeImage = source.thumbnail;
		if (nativeImage.isEmpty()) continue;

		const display = displays.find((d) => source.display_id === String(d.id));

		results.push({
			id: uuid(),
			displayId: source.display_id,
			pngBuffer: nativeImage.toPNG(),
			width: display?.size.width ?? 1920,
			height: display?.size.height ?? 1080,
			timestamp,
		});
	}

	return results;
}

export async function processRawCaptures(
	rawCaptures: RawCapture[],
	options?: {
		highResDisplayId?: string | null;
		dirs?: { thumbnailsDir: string; originalsDir: string };
	},
): Promise<CaptureResult[]> {
	const highResDisplayId = options?.highResDisplayId ?? null;
	const thumbnailsDir = options?.dirs?.thumbnailsDir ?? getThumbnailsDir();
	const originalsDir = options?.dirs?.originalsDir ?? getOriginalsDir();

	const results: CaptureResult[] = [];

	for (const raw of rawCaptures) {
		const thumbnailPath = join(thumbnailsDir, `${raw.id}.webp`);
		const originalPath = join(originalsDir, `${raw.id}.webp`);
		const highResPath = highResPathForId(raw.id, originalsDir);

		const [original, thumbnail] = await Promise.all([
			sharp(raw.pngBuffer)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			sharp(raw.pngBuffer)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && raw.displayId === highResDisplayId) {
			writePromises.push(writeFile(highResPath, raw.pngBuffer));
		}

		const [fingerprint] = await Promise.all([
			computeFingerprint(original),
			...writePromises,
		]);

		results.push({
			id: raw.id,
			timestamp: raw.timestamp,
			displayId: raw.displayId,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: raw.width,
			height: raw.height,
		});
	}

	return results;
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

		const [original, thumbnail] = await Promise.all([
			sharp(pngBuffer)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			sharp(pngBuffer)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && source.display_id === highResDisplayId) {
			writePromises.push(writeFile(highResPath, pngBuffer));
		}

		const [fingerprint] = await Promise.all([
			computeFingerprint(original),
			...writePromises,
		]);

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

	const primaryDisplayId = String(screen.getPrimaryDisplay().id);
	const primarySource =
		sources.find((s) => s.display_id === primaryDisplayId) ?? sources[0];
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
