import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, ipcMain } from "electron";
import { createLogger } from "../../infra/log";
import { getScreenshotsDir } from "../../infra/paths";
import {
	addTrustedWebContentsId,
	removeTrustedWebContentsId,
} from "../../ipc/secure";

const logger = createLogger({ scope: "SocialShareImageService" });

export interface SocialShareImageInput {
	imagePaths: string[];
	title: string;
	timestamp: number;
	category: string | null;
	appName: string | null;
	appIconPath: string | null;
	backgroundTitle: string | null;
	backgroundArtist: string | null;
	backgroundImageUrl: string | null;
}

interface SocialSharePayload {
	imageUrl: string;
	appIconPath: string | null;
	title: string;
	timestamp: number;
	category: string | null;
	appName: string | null;
	backgroundTitle: string | null;
	backgroundArtist: string | null;
	backgroundImageUrl: string | null;
}

function isSubpath(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function resolveSafePath(screenshotsRoot: string, path: string): string | null {
	const absolutePath = isAbsolute(path) ? path : resolve(path);
	if (!existsSync(absolutePath)) return null;

	let realPath: string;
	try {
		realPath = realpathSync(absolutePath);
	} catch {
		return null;
	}

	if (!isSubpath(screenshotsRoot, realPath)) return null;
	return realPath;
}

function ensureDir(dir: string): string {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function pathToLocalFileUrl(filePath: string): string {
	return `local-file://${filePath}`;
}

export async function generateSocialShareImage(
	input: SocialShareImageInput,
): Promise<string> {
	const screenshotsRoot = realpathSync(getScreenshotsDir());

	const imagePath =
		input.imagePaths
			.map((p) => resolveSafePath(screenshotsRoot, p))
			.find((p): p is string => Boolean(p)) ?? null;
	if (!imagePath) throw new Error("No valid image path");

	const iconPath = input.appIconPath
		? resolveSafePath(screenshotsRoot, input.appIconPath)
		: null;

	const appIconUrl = iconPath ? pathToLocalFileUrl(iconPath) : null;

	const payload: SocialSharePayload = {
		imageUrl: pathToLocalFileUrl(imagePath),
		appIconPath: appIconUrl,
		title: input.title,
		timestamp: input.timestamp,
		category: input.category,
		appName: input.appName,
		backgroundTitle: input.backgroundTitle,
		backgroundArtist: input.backgroundArtist,
		backgroundImageUrl: input.backgroundImageUrl,
	};

	const requestId = randomUUID();

	return new Promise((resolvePromise, rejectPromise) => {
		let window: BrowserWindow | null = null;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let resolved = false;

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			ipcMain.removeHandler(`social-share:request-data:${requestId}`);
			ipcMain.removeListener(`social-share:ready:${requestId}`, onReady);
			if (window && !window.isDestroyed()) {
				const wcId = window.webContents.id;
				removeTrustedWebContentsId(wcId);
				window.destroy();
			}
			window = null;
		};

		const onReady = async () => {
			if (resolved || !window || window.isDestroyed()) return;

			try {
				await new Promise((r) => setTimeout(r, 50));

				const image = await window.webContents.capturePage();
				const pngBuffer = image.toPNG();

				const outDir = ensureDir(join(getScreenshotsDir(), "social"));
				const outPath = join(outDir, `${randomUUID()}.png`);
				await writeFile(outPath, pngBuffer);

				logger.info("Generated social image", { outPath });
				resolved = true;
				cleanup();
				resolvePromise(outPath);
			} catch (error) {
				logger.error("Failed to capture social image", { error });
				resolved = true;
				cleanup();
				rejectPromise(error);
			}
		};

		ipcMain.handle(`social-share:request-data:${requestId}`, () => payload);
		ipcMain.once(`social-share:ready:${requestId}`, onReady);

		window = new BrowserWindow({
			width: 1920,
			height: 1080,
			show: false,
			frame: false,
			transparent: false,
			backgroundColor: "#000000",
			webPreferences: {
				preload: join(__dirname, "../preload/index.cjs"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});

		addTrustedWebContentsId(window.webContents.id);

		const url = process.env.ELECTRON_RENDERER_URL
			? `${process.env.ELECTRON_RENDERER_URL}#social-share/${requestId}`
			: pathToFileURL(join(__dirname, "../renderer/index.html")).toString() +
				`#social-share/${requestId}`;

		window.loadURL(url);

		timeoutId = setTimeout(() => {
			if (resolved) return;
			logger.error("Social share image generation timed out");
			resolved = true;
			cleanup();
			rejectPromise(new Error("Timeout generating social share image"));
		}, 15000);
	});
}
