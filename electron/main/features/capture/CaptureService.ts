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
	rawBuffer: Buffer;
	capturedWidth: number;
	capturedHeight: number;
	displayWidth: number;
	displayHeight: number;
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

function bgraToRgba(bgra: Buffer, pixelCount: number): Buffer {
	const view = new Uint32Array(bgra.buffer, bgra.byteOffset, pixelCount);
	const result = new Uint32Array(pixelCount);

	for (let i = 0; i < pixelCount; i++) {
		const px = view[i];
		result[i] =
			(px & 0xff00ff00) | ((px >>> 16) & 0x000000ff) | ((px & 0x000000ff) << 16);
	}

	return Buffer.from(result.buffer);
}

function nativeImageToRgba(nativeImage: Electron.NativeImage): {
	buffer: Buffer;
	width: number;
	height: number;
} {
	const size = nativeImage.getSize();
	const bitmap = nativeImage.toBitmap();
	const pixelCount = size.width * size.height;
	const rgbaBuffer = bgraToRgba(bitmap, pixelCount);

	return {
		buffer: rgbaBuffer,
		width: size.width,
		height: size.height,
	};
}

function createSharpFromRgba(
	buffer: Buffer,
	width: number,
	height: number,
): sharp.Sharp {
	return sharp(buffer, {
		raw: { width, height, channels: 4 },
	});
}

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

	const rawSources = capture.sources.map((source) => ({
		...source,
		rgba: nativeImageToRgba(source.nativeImage),
	}));

	const processPromises = rawSources.map(async (source) => {
		const thumbnailPath = join(thumbnailsDir, `${source.id}.webp`);
		const originalPath = join(originalsDir, `${source.id}.webp`);
		const highResPath = highResPathForId(source.id, originalsDir);

		const [original, thumbnail] = await Promise.all([
			createSharpFromRgba(source.rgba.buffer, source.rgba.width, source.rgba.height)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			createSharpFromRgba(source.rgba.buffer, source.rgba.width, source.rgba.height)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && source.displayId === highResDisplayId) {
			const pngBuffer = await createSharpFromRgba(
				source.rgba.buffer,
				source.rgba.width,
				source.rgba.height,
			)
				.png()
				.toBuffer();
			writePromises.push(writeFile(highResPath, pngBuffer));
		}

		const [fingerprint] = await Promise.all([
			computeFingerprint(original),
			...writePromises,
		]);

		return {
			id: source.id,
			timestamp: capture.timestamp,
			displayId: source.displayId,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: source.width,
			height: source.height,
		};
	});

	return Promise.all(processPromises);
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
		const rgba = nativeImageToRgba(nativeImage);

		results.push({
			id: uuid(),
			displayId: source.display_id,
			rawBuffer: rgba.buffer,
			capturedWidth: rgba.width,
			capturedHeight: rgba.height,
			displayWidth: display?.size.width ?? 1920,
			displayHeight: display?.size.height ?? 1080,
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

	const processPromises = rawCaptures.map(async (raw) => {
		const thumbnailPath = join(thumbnailsDir, `${raw.id}.webp`);
		const originalPath = join(originalsDir, `${raw.id}.webp`);
		const highResPath = highResPathForId(raw.id, originalsDir);

		const [original, thumbnail] = await Promise.all([
			createSharpFromRgba(raw.rawBuffer, raw.capturedWidth, raw.capturedHeight)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			createSharpFromRgba(raw.rawBuffer, raw.capturedWidth, raw.capturedHeight)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && raw.displayId === highResDisplayId) {
			const pngBuffer = await createSharpFromRgba(
				raw.rawBuffer,
				raw.capturedWidth,
				raw.capturedHeight,
			)
				.png()
				.toBuffer();
			writePromises.push(writeFile(highResPath, pngBuffer));
		}

		const [fingerprint] = await Promise.all([
			computeFingerprint(original),
			...writePromises,
		]);

		return {
			id: raw.id,
			timestamp: raw.timestamp,
			displayId: raw.displayId,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: raw.displayWidth,
			height: raw.displayHeight,
		};
	});

	return Promise.all(processPromises);
}

interface RawSourceData {
	id: string;
	displayId: string;
	rgba: { buffer: Buffer; width: number; height: number };
	displayWidth: number;
	displayHeight: number;
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

	const timestamp = Date.now();

	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: bestThumbnailSize(),
	});

	logger.debug(`Got ${sources.length} screen sources`);

	const rawSources: RawSourceData[] = [];

	for (const source of sources) {
		logger.debug(
			`Processing source: ${source.name}, display_id: ${source.display_id}`,
		);

		const nativeImage = source.thumbnail;
		if (nativeImage.isEmpty()) {
			logger.warn("Native image is empty - permission might be denied");
			continue;
		}

		const display = displays.find((d) => source.display_id === String(d.id));
		const rgba = nativeImageToRgba(nativeImage);

		logger.debug(`Raw buffer size: ${rgba.buffer.length} bytes`);

		rawSources.push({
			id: uuid(),
			displayId: source.display_id,
			rgba,
			displayWidth: display?.size.width ?? 1920,
			displayHeight: display?.size.height ?? 1080,
		});
	}

	const processPromises = rawSources.map(async (raw) => {
		const thumbnailPath = join(thumbnailsDir, `${raw.id}.webp`);
		const originalPath = join(originalsDir, `${raw.id}.webp`);
		const highResPath = highResPathForId(raw.id, originalsDir);

		const [original, thumbnail] = await Promise.all([
			createSharpFromRgba(raw.rgba.buffer, raw.rgba.width, raw.rgba.height)
				.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
			createSharpFromRgba(raw.rgba.buffer, raw.rgba.width, raw.rgba.height)
				.resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toBuffer(),
		]);

		const writePromises: Promise<void>[] = [
			writeFile(originalPath, original),
			writeFile(thumbnailPath, thumbnail),
		];

		if (highResDisplayId && raw.displayId === highResDisplayId) {
			const pngBuffer = await createSharpFromRgba(
				raw.rgba.buffer,
				raw.rgba.width,
				raw.rgba.height,
			)
				.png()
				.toBuffer();
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

		return {
			id: raw.id,
			timestamp,
			displayId: raw.displayId,
			thumbnailPath,
			originalPath,
			stableHash: fingerprint.stableHash,
			detailHash: fingerprint.detailHash,
			width: raw.displayWidth,
			height: raw.displayHeight,
		};
	});

	const results = await Promise.all(processPromises);

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

	const rgba = nativeImageToRgba(nativeImage);

	const resized = await createSharpFromRgba(rgba.buffer, rgba.width, rgba.height)
		.resize(ORIGINAL_WIDTH, null, { withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer();

	return resized;
}
