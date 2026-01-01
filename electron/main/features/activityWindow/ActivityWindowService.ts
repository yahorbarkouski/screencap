import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { screen } from "electron";
import { v4 as uuid } from "uuid";
import { SELF_APP_BUNDLE_ID } from "../../../shared/appIdentity";
import type { CaptureResult } from "../../../shared/types";
import { getOriginalsDir, getTempCapturesDir, getThumbnailsDir } from "../../infra/paths";
import { createLogger } from "../../infra/log";
import { getSettings } from "../../infra/settings";
import { evaluateAutomationPolicy } from "../automationRules";
import { captureAllDisplays } from "../capture";
import { collectActivityContext, collectForegroundSnapshot } from "../context";
import type { ActivityContext, ForegroundSnapshot } from "../context";
import { chromiumProvider, safariProvider } from "../context/providers";
import { computeDominantSegment, type ActivitySegment } from "./dominance";

const logger = createLogger({ scope: "ActivityWindow" });

const POLL_MS = 1_000;
const BROWSER_HOST_REFRESH_MS = 2_000;
const MIN_STABLE_MS = 10_000;
const INTERRUPTION_MAX_MS = 10_000;

type Segment = ActivitySegment;

type Candidate = {
	key: string;
	bundleId: string;
	displayId: string;
	primaryDisplayId: string | null;
	context: ActivityContext | null;
	captures: CaptureResult[];
};

export type WindowedCaptureResult =
	| {
			kind: "capture";
			windowStart: number;
			windowEnd: number;
			primaryDisplayId: string | null;
			context: ActivityContext | null;
			captures: CaptureResult[];
	  }
	| {
			kind: "skip";
			windowStart: number;
			windowEnd: number;
			reason:
				| "not-running"
				| "no-data"
				| "self"
				| "excluded"
				| "policy-skip"
				| "no-candidate";
	  };

type ServiceState = {
	status: "stopped" | "running";
	windowStart: number;
	windowId: string | null;
	windowDir: string | null;
	windowThumbnailsDir: string | null;
	windowOriginalsDir: string | null;
	segments: Segment[];
	current: Segment | null;
	candidates: Map<string, Candidate>;
	lastSnapshot: ForegroundSnapshot | null;
	browserHostCache: {
		bundleId: string;
		displayId: string;
		host: string | null;
		updatedAt: number;
	} | null;
	pollTimer: NodeJS.Timeout | null;
	pollInFlight: Promise<void> | null;
	captureInFlight: Promise<void> | null;
};

const state: ServiceState = {
	status: "stopped",
	windowStart: Date.now(),
	windowId: null,
	windowDir: null,
	windowThumbnailsDir: null,
	windowOriginalsDir: null,
	segments: [],
	current: null,
	candidates: new Map(),
	lastSnapshot: null,
	browserHostCache: null,
	pollTimer: null,
	pollInFlight: null,
	captureInFlight: null,
};

function buildKey(
	displayId: string,
	bundleId: string,
	urlHost: string | null,
): string {
	if (urlHost) return `${displayId}::host:${bundleId}:${urlHost}`;
	return `${displayId}::app:${bundleId}`;
}

async function resolveUrlHost(
	snapshot: ForegroundSnapshot,
	displayId: string,
): Promise<string | null> {
	if (!chromiumProvider.supports(snapshot) && !safariProvider.supports(snapshot))
		return null;

	const now = snapshot.capturedAt;
	const bundleId = snapshot.app.bundleId;
	const cached = state.browserHostCache;

	if (
		cached &&
		cached.bundleId === bundleId &&
		cached.displayId === displayId &&
		now - cached.updatedAt < BROWSER_HOST_REFRESH_MS
	) {
		return cached.host;
	}

	let host: string | null = null;
	try {
		const enrichment = chromiumProvider.supports(snapshot)
			? await chromiumProvider.collect(snapshot)
			: await safariProvider.collect(snapshot);
		host = enrichment?.url?.host ?? null;
	} catch {
		host = null;
	}

	state.browserHostCache = { bundleId, displayId, host, updatedAt: now };
	return host;
}

function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}

function cleanupTempRoot(): void {
	const root = getTempCapturesDir();
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		rmSync(join(root, entry.name), { recursive: true, force: true });
	}
}

function initWindow(now: number, continuation: ForegroundSnapshot | null): void {
	state.windowStart = now;
	state.segments = [];
	state.candidates.clear();

	state.windowId = uuid();
	state.windowDir = join(getTempCapturesDir(), state.windowId);
	state.windowThumbnailsDir = join(state.windowDir, "thumbnails");
	state.windowOriginalsDir = join(state.windowDir, "originals");
	ensureDir(state.windowThumbnailsDir);
	ensureDir(state.windowOriginalsDir);

	if (!continuation) {
		state.current = null;
		return;
	}

	const displayId =
		continuation.window.displayId ?? String(screen.getPrimaryDisplay().id);
	const bundleId = continuation.app.bundleId;
	state.current = {
		key: buildKey(displayId, bundleId, null),
		bundleId,
		displayId,
		urlHost: null,
		startAt: now,
		endAt: null,
	};
}

function closeCurrent(endAt: number): void {
	if (!state.current) return;
	if (endAt <= state.current.startAt) {
		state.current = null;
		return;
	}
	state.segments.push({ ...state.current, endAt });
	state.current = null;
}

function shouldSkipContext(context: ActivityContext | null): boolean {
	if (!context) return false;
	const settings = getSettings();
	if (context.app.bundleId === SELF_APP_BUNDLE_ID) return true;
	if (settings.excludedApps.includes(context.app.bundleId)) return true;
	const policy = evaluateAutomationPolicy(
		{
			appBundleId: context.app.bundleId,
			urlHost: context.url?.host ?? null,
		},
		settings.automationRules,
	);
	return policy.capture === "skip";
}

function shouldSkipBundleId(bundleId: string, urlHost: string | null): boolean {
	const settings = getSettings();
	if (bundleId === SELF_APP_BUNDLE_ID) return true;
	if (settings.excludedApps.includes(bundleId)) return true;
	const policy = evaluateAutomationPolicy(
		{ appBundleId: bundleId, urlHost },
		settings.automationRules,
	);
	return policy.capture === "skip";
}

function movedPath(destDir: string, sourcePath: string): string {
	return join(destDir, basename(sourcePath));
}

function highResPathFromOriginal(originalPath: string): string {
	return originalPath.replace(/\.webp$/, ".hq.png");
}

function moveCaptureFilesToPermanent(capture: CaptureResult): CaptureResult {
	const thumbnailPath = movedPath(getThumbnailsDir(), capture.thumbnailPath);
	const originalPath = movedPath(getOriginalsDir(), capture.originalPath);

	renameSync(capture.thumbnailPath, thumbnailPath);
	renameSync(capture.originalPath, originalPath);

	const tempHighRes = highResPathFromOriginal(capture.originalPath);
	if (existsSync(tempHighRes)) {
		const destHighRes = movedPath(getOriginalsDir(), tempHighRes);
		renameSync(tempHighRes, destHighRes);
	}

	return { ...capture, thumbnailPath, originalPath };
}

async function captureCandidate(target: {
	key: string;
	bundleId: string;
	displayId: string;
	urlHost: string | null;
}): Promise<void> {
	if (state.status !== "running") return;
	if (state.candidates.has(target.key)) return;
	if (!state.windowThumbnailsDir || !state.windowOriginalsDir) return;

	let release!: () => void;
	state.captureInFlight = new Promise<void>((resolve) => {
		release = resolve;
	});

	try {
		const context = await collectActivityContext();
		if (state.status !== "running") return;
		if (!context) return;
		if (context.app.bundleId !== target.bundleId) return;
		if (context.window.displayId && context.window.displayId !== target.displayId)
			return;
		if (target.urlHost && context.url?.host !== target.urlHost) return;
		if (shouldSkipContext(context)) return;

		const primaryDisplayId =
			context.window.displayId ?? target.displayId ?? String(screen.getPrimaryDisplay().id);

		const captures = await captureAllDisplays({
			highResDisplayId: primaryDisplayId,
			dirs: {
				thumbnailsDir: state.windowThumbnailsDir,
				originalsDir: state.windowOriginalsDir,
			},
		});

		if (state.status !== "running") return;
		if (captures.length === 0) return;

		state.candidates.set(target.key, {
			key: target.key,
			bundleId: target.bundleId,
			displayId: target.displayId,
			primaryDisplayId,
			context,
			captures,
		});
	} catch (error) {
		logger.debug("Candidate capture failed", { error });
	} finally {
		release();
		state.captureInFlight = null;
	}
}

async function pollOnce(): Promise<void> {
	if (state.status !== "running") return;
	const snapshot = await collectForegroundSnapshot();
	if (state.status !== "running") return;
	if (!snapshot) return;

	state.lastSnapshot = snapshot;

	const now = snapshot.capturedAt;
	const displayId = snapshot.window.displayId ?? String(screen.getPrimaryDisplay().id);
	const bundleId = snapshot.app.bundleId;
	const urlHost = await resolveUrlHost(snapshot, displayId);
	const key = buildKey(displayId, bundleId, urlHost);

	if (!state.current) {
		state.current = {
			key,
			bundleId,
			displayId,
			urlHost,
			startAt: Math.max(state.windowStart, now),
			endAt: null,
		};
		return;
	}

	if (key !== state.current.key) {
		closeCurrent(now);
		state.current = {
			key,
			bundleId,
			displayId,
			urlHost,
			startAt: now,
			endAt: null,
		};
	}

	if (state.candidates.has(key)) return;
	if (now - state.current.startAt < MIN_STABLE_MS) return;
	if (state.captureInFlight) return;

	void captureCandidate({ key, bundleId, displayId, urlHost });
}

export function startActivityWindowTracking(): void {
	if (state.status === "running") return;
	cleanupTempRoot();
	state.status = "running";
	initWindow(Date.now(), null);
	void pollOnce();
	state.pollTimer = setInterval(() => {
		if (state.pollInFlight) return;
		state.pollInFlight = pollOnce()
			.catch(() => {})
			.finally(() => {
				state.pollInFlight = null;
			});
	}, POLL_MS);
	logger.info("Activity window tracking started");
}

export function stopActivityWindowTracking(): void {
	if (state.pollTimer) {
		clearInterval(state.pollTimer);
		state.pollTimer = null;
	}
	state.status = "stopped";
	const windowDir = state.windowDir;
	const cleanup = () => {
		if (windowDir) rmSync(windowDir, { recursive: true, force: true });
	};
	if (state.captureInFlight) {
		void state.captureInFlight.finally(cleanup);
	} else {
		cleanup();
	}
	state.windowId = null;
	state.windowDir = null;
	state.windowThumbnailsDir = null;
	state.windowOriginalsDir = null;
	state.segments = [];
	state.current = null;
	state.candidates.clear();
	state.lastSnapshot = null;
	logger.info("Activity window tracking stopped");
}

export function isActivityWindowTracking(): boolean {
	return state.status === "running";
}

export async function discardActivityWindow(windowEnd: number): Promise<void> {
	if (state.captureInFlight) await state.captureInFlight;
	const continuation = state.lastSnapshot;
	if (state.windowDir) rmSync(state.windowDir, { recursive: true, force: true });
	initWindow(windowEnd, continuation);
}

export async function finalizeActivityWindow(
	windowEnd: number,
): Promise<WindowedCaptureResult> {
	const windowStart = state.windowStart;

	if (state.status !== "running") {
		return { kind: "skip", windowStart, windowEnd, reason: "not-running" };
	}

	if (state.captureInFlight) await state.captureInFlight;

	const finalized: Segment[] = [...state.segments];
	if (state.current) finalized.push({ ...state.current, endAt: windowEnd });

	const dominant = computeDominantSegment(
		finalized,
		windowEnd,
		INTERRUPTION_MAX_MS,
	);

	const continuation = state.lastSnapshot;
	const currentWindowDir = state.windowDir;

	if (!dominant) {
		if (currentWindowDir) rmSync(currentWindowDir, { recursive: true, force: true });
		initWindow(windowEnd, continuation);
		return { kind: "skip", windowStart, windowEnd, reason: "no-data" };
	}

	if (shouldSkipBundleId(dominant.bundleId, dominant.urlHost)) {
		if (currentWindowDir) rmSync(currentWindowDir, { recursive: true, force: true });
		initWindow(windowEnd, continuation);
		return {
			kind: "skip",
			windowStart,
			windowEnd,
			reason:
				dominant.bundleId === SELF_APP_BUNDLE_ID
					? "self"
					: getSettings().excludedApps.includes(dominant.bundleId)
						? "excluded"
						: "policy-skip",
		};
	}

	const candidate = state.candidates.get(dominant.key) ?? null;
	if (!candidate) {
		if (currentWindowDir) rmSync(currentWindowDir, { recursive: true, force: true });
		initWindow(windowEnd, continuation);
		return { kind: "skip", windowStart, windowEnd, reason: "no-candidate" };
	}

	let captures: CaptureResult[] = [];
	try {
		captures = candidate.captures.map(moveCaptureFilesToPermanent).map((c) => ({
			...c,
			timestamp: windowEnd,
		}));
	} catch (error) {
		logger.debug("Failed to finalize candidate capture", { error });
		if (currentWindowDir) rmSync(currentWindowDir, { recursive: true, force: true });
		initWindow(windowEnd, continuation);
		return { kind: "skip", windowStart, windowEnd, reason: "no-candidate" };
	}

	if (currentWindowDir) rmSync(currentWindowDir, { recursive: true, force: true });
	initWindow(windowEnd, continuation);

	return {
		kind: "capture",
		windowStart,
		windowEnd,
		primaryDisplayId: candidate.primaryDisplayId,
		context: candidate.context,
		captures,
	};
}

