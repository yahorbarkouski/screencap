import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { powerMonitor, screen } from "electron";
import { v4 as uuid } from "uuid";
import { SELF_APP_BUNDLE_ID } from "../../../shared/appIdentity";
import type { CaptureResult } from "../../../shared/types";
import { createLogger } from "../../infra/log";
import {
	getOriginalsDir,
	getTempCapturesDir,
	getThumbnailsDir,
} from "../../infra/paths";
import { getSettings } from "../../infra/settings";
import { evaluateAutomationPolicy } from "../automationRules";
import { captureAllDisplays } from "../capture";
import type { ActivityContext, ForegroundSnapshot } from "../context";
import { collectActivityContext, collectForegroundSnapshot } from "../context";
import { chromiumProvider, safariProvider } from "../context/providers";
import { type ActivitySegment, computeDominantSegment } from "./dominance";
import { createPerfTracker } from "../../infra/log/perf";

const logger = createLogger({ scope: "ActivityWindow" });
const perf = createPerfTracker("Perf.ActivityWindow");

const POLL_MS = 3_000;
const BROWSER_HOST_REFRESH_MS = 2_000;
const MIN_STABLE_MS = 10_000;
const MIN_DOMINANT_TOTAL_MS = 10_000;
const IDLE_AWAY_SECONDS = 5 * 60;
const IDLE_BUNDLE_ID = "__idle__";

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

let lockQueue: Promise<void> = Promise.resolve();

async function withWindowLock<T>(fn: () => Promise<T>): Promise<T> {
	let release!: () => void;
	const prev = lockQueue;
	lockQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await prev;
	try {
		return await fn();
	} finally {
		release();
	}
}

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
	if (
		!chromiumProvider.supports(snapshot) &&
		!safariProvider.supports(snapshot)
	)
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

async function ensureDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

async function cleanupTempRoot(): Promise<void> {
	const root = getTempCapturesDir();
	try {
		const entries = await readdir(root, { withFileTypes: true });
		await Promise.all(
			entries.map((entry) =>
				rm(join(root, entry.name), { recursive: true, force: true }),
			),
		);
	} catch {}
}

async function safeRm(path: string | null): Promise<void> {
	if (!path) return;
	try {
		await rm(path, { recursive: true, force: true });
	} catch {}
}

async function initWindow(
	now: number,
	continuation: ForegroundSnapshot | null,
): Promise<void> {
	state.windowStart = now;
	state.segments = [];
	state.candidates.clear();

	state.windowId = uuid();
	state.windowDir = join(getTempCapturesDir(), state.windowId);
	state.windowThumbnailsDir = join(state.windowDir, "thumbnails");
	state.windowOriginalsDir = join(state.windowDir, "originals");
	await Promise.all([
		ensureDir(state.windowThumbnailsDir),
		ensureDir(state.windowOriginalsDir),
	]);

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
	if (context.app.bundleId === SELF_APP_BUNDLE_ID) return true;
	const settings = getSettings();
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
	if (bundleId === SELF_APP_BUNDLE_ID) return true;
	const settings = getSettings();
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

async function moveCaptureFilesToPermanent(
	capture: CaptureResult,
): Promise<CaptureResult> {
	const thumbnailPath = movedPath(getThumbnailsDir(), capture.thumbnailPath);
	const originalPath = movedPath(getOriginalsDir(), capture.originalPath);
	const tempHighRes = highResPathFromOriginal(capture.originalPath);
	const destHighRes = movedPath(getOriginalsDir(), tempHighRes);

	await Promise.all([
		rename(capture.thumbnailPath, thumbnailPath),
		rename(capture.originalPath, originalPath),
		rename(tempHighRes, destHighRes).catch(() => {}),
	]);

	return { ...capture, thumbnailPath, originalPath };
}

async function captureCandidate(target: {
	key: string;
	bundleId: string;
	displayId: string;
	urlHost: string | null;
}): Promise<void> {
	const startedAt = perf.enabled ? performance.now() : 0;
	if (state.status !== "running") return;
	if (powerMonitor.getSystemIdleTime() > IDLE_AWAY_SECONDS) return;
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
		if (
			context.window.displayId &&
			context.window.displayId !== target.displayId
		)
			return;
		if (target.urlHost && context.url?.host !== target.urlHost) return;
		if (shouldSkipContext(context)) return;

		const primaryDisplayId =
			context.window.displayId ??
			target.displayId ??
			String(screen.getPrimaryDisplay().id);

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
		if (perf.enabled)
			perf.track("activity.captureCandidate", performance.now() - startedAt);
	}
}

async function pollOnce(): Promise<void> {
	const pollStartedAt = perf.enabled ? performance.now() : 0;
	await withWindowLock(async () => {
		if (state.status !== "running") return;
		const idleTimeSeconds = powerMonitor.getSystemIdleTime();
		const now = Date.now();

		if (idleTimeSeconds > IDLE_AWAY_SECONDS) {
			const idleStartAt = Math.max(
				state.windowStart,
				now - idleTimeSeconds * 1000,
			);
			const displayId =
				state.current?.displayId ??
				state.lastSnapshot?.window.displayId ??
				String(screen.getPrimaryDisplay().id);

			if (state.current?.bundleId !== IDLE_BUNDLE_ID) {
				closeCurrent(idleStartAt);
				state.current = {
					key: buildKey(displayId, IDLE_BUNDLE_ID, null),
					bundleId: IDLE_BUNDLE_ID,
					displayId,
					urlHost: null,
					startAt: idleStartAt,
					endAt: null,
				};
			}
			return;
		}

		if (state.current?.bundleId === IDLE_BUNDLE_ID) {
			const activeAt = Math.max(
				state.windowStart,
				now - idleTimeSeconds * 1000,
			);
			closeCurrent(activeAt);
		}

		const snapshotStart = perf.enabled ? performance.now() : 0;
		const snapshot = await collectForegroundSnapshot();
		if (perf.enabled)
			perf.track(
				"activity.collectForegroundSnapshot",
				performance.now() - snapshotStart,
			);
		if (state.status !== "running") return;
		if (!snapshot) return;

		state.lastSnapshot = snapshot;

		const capturedAt = snapshot.capturedAt;
		const displayId =
			snapshot.window.displayId ?? String(screen.getPrimaryDisplay().id);
		const bundleId = snapshot.app.bundleId;
		const hostStart = perf.enabled ? performance.now() : 0;
		const urlHost = await resolveUrlHost(snapshot, displayId);
		if (perf.enabled)
			perf.track("activity.resolveUrlHost", performance.now() - hostStart);
		const key = buildKey(displayId, bundleId, urlHost);

		if (!state.current) {
			state.current = {
				key,
				bundleId,
				displayId,
				urlHost,
				startAt: Math.max(state.windowStart, capturedAt),
				endAt: null,
			};
			return;
		}

		if (key !== state.current.key) {
			closeCurrent(capturedAt);
			state.current = {
				key,
				bundleId,
				displayId,
				urlHost,
				startAt: capturedAt,
				endAt: null,
			};
		}

		if (state.candidates.has(key)) return;
		if (capturedAt - state.current.startAt < MIN_STABLE_MS) return;
		if (state.captureInFlight) return;

		void captureCandidate({ key, bundleId, displayId, urlHost });
	});
	if (perf.enabled)
		perf.track("activity.pollOnce", performance.now() - pollStartedAt);
}

export function startActivityWindowTracking(): void {
	if (state.status === "running") return;
	state.status = "running";
	state.pollInFlight = cleanupTempRoot()
		.then(() => initWindow(Date.now(), null))
		.then(() => pollOnce())
		.catch(() => {})
		.finally(() => {
			state.pollInFlight = null;
		});
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
	if (state.captureInFlight) {
		void state.captureInFlight.finally(() => safeRm(windowDir));
	} else {
		void safeRm(windowDir);
	}
	state.windowId = null;
	state.windowDir = null;
	state.windowThumbnailsDir = null;
	state.windowOriginalsDir = null;
	state.segments = [];
	state.current = null;
	state.candidates.clear();
	state.lastSnapshot = null;
	state.browserHostCache = null;
	logger.info("Activity window tracking stopped");
}

export function isActivityWindowTracking(): boolean {
	return state.status === "running";
}

export function getLastKnownSnapshot(): ForegroundSnapshot | null {
	return state.lastSnapshot;
}

export function getLastKnownCandidate(): {
	context: ActivityContext | null;
	bundleId: string;
} | null {
	if (!state.current) return null;
	if (state.current.bundleId === IDLE_BUNDLE_ID) return null;
	if (state.current.bundleId === SELF_APP_BUNDLE_ID) return null;

	const candidate = state.candidates.get(state.current.key);
	if (candidate) {
		return { context: candidate.context, bundleId: candidate.bundleId };
	}

	for (const segment of [...state.segments].reverse()) {
		if (segment.bundleId === IDLE_BUNDLE_ID) continue;
		if (segment.bundleId === SELF_APP_BUNDLE_ID) continue;
		const segmentCandidate = state.candidates.get(segment.key);
		if (segmentCandidate) {
			return {
				context: segmentCandidate.context,
				bundleId: segmentCandidate.bundleId,
			};
		}
	}

	return null;
}

export async function discardActivityWindow(windowEnd: number): Promise<void> {
	await withWindowLock(async () => {
		const safeWindowEnd = Math.max(state.windowStart, windowEnd);
		if (state.captureInFlight) await state.captureInFlight;
		const continuation = state.lastSnapshot;
		await safeRm(state.windowDir);
		await initWindow(safeWindowEnd, continuation);
	});
}

export async function finalizeActivityWindow(
	windowEnd: number,
): Promise<WindowedCaptureResult> {
	return await withWindowLock(async () => {
		const windowStart = state.windowStart;
		const safeWindowEnd = Math.max(windowStart, windowEnd);

		if (state.status !== "running") {
			return {
				kind: "skip",
				windowStart,
				windowEnd: safeWindowEnd,
				reason: "not-running",
			};
		}

		if (state.captureInFlight) await state.captureInFlight;

		const finalized: Segment[] = [...state.segments];
		if (state.current)
			finalized.push({ ...state.current, endAt: safeWindowEnd });
		const activeSegments = finalized.filter(
			(s) => s.bundleId !== IDLE_BUNDLE_ID,
		);

		const dominant = computeDominantSegment(
			activeSegments,
			safeWindowEnd,
			MIN_DOMINANT_TOTAL_MS,
		);

		const continuation = state.lastSnapshot;
		const currentWindowDir = state.windowDir;

		const cleanupAndInit = async () => {
			await safeRm(currentWindowDir);
			await initWindow(safeWindowEnd, continuation);
		};

		if (!dominant) {
			await cleanupAndInit();
			return {
				kind: "skip",
				windowStart,
				windowEnd: safeWindowEnd,
				reason: "no-data",
			};
		}

		if (shouldSkipBundleId(dominant.bundleId, dominant.urlHost)) {
			await cleanupAndInit();
			return {
				kind: "skip",
				windowStart,
				windowEnd: safeWindowEnd,
				reason:
					dominant.bundleId === SELF_APP_BUNDLE_ID ? "self" : "policy-skip",
			};
		}

		const candidate = state.candidates.get(dominant.key) ?? null;
		if (!candidate) {
			await cleanupAndInit();
			return {
				kind: "skip",
				windowStart,
				windowEnd: safeWindowEnd,
				reason: "no-candidate",
			};
		}

		let captures: CaptureResult[] = [];
		try {
			const movedCaptures = await Promise.all(
				candidate.captures.map(moveCaptureFilesToPermanent),
			);
			captures = movedCaptures.map((c) => ({
				...c,
				timestamp: safeWindowEnd,
			}));
		} catch (error) {
			logger.debug("Failed to finalize candidate capture", { error });
			await cleanupAndInit();
			return {
				kind: "skip",
				windowStart,
				windowEnd: safeWindowEnd,
				reason: "no-candidate",
			};
		}

		await cleanupAndInit();

		return {
			kind: "capture",
			windowStart,
			windowEnd: safeWindowEnd,
			primaryDisplayId: candidate.primaryDisplayId,
			context: candidate.context,
			captures,
		};
	});
}
