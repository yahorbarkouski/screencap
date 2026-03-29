import {
	createHash,
	createPublicKey,
	randomInt,
	randomUUID,
	verify,
} from "node:crypto";
import { existsSync, statSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { hostname, networkInterfaces } from "node:os";
import { endOfDay, startOfDay } from "date-fns";
import type {
	DevicePairingSession,
	DevicePairingSessionStatus,
	GetMobileActivityDaysOptions,
	MobileActivityBucketApp,
	MobileActivityBucketDomain,
	MobileActivityDay,
	MobileActivityHourBucket,
	MobileActivitySyncStatus,
	PairedDevice,
} from "../../../shared/types";
import { getEvents } from "../../infra/db/repositories/EventRepository";
import {
	deleteCachedMobileActivityDaysByDeviceId,
	listCachedMobileActivityDays,
	upsertCachedMobileActivityDays,
} from "../../infra/db/repositories/MobileActivityDayRepository";
import {
	deleteMobilePairedDevice,
	getMobilePairedDevice,
	listMobilePairedDevices,
	type StoredMobilePairedDevice,
	touchMobilePairedDevice,
	upsertMobilePairedDevice,
} from "../../infra/db/repositories/MobilePairedDeviceRepository";
import {
	createLogger,
	formatLogsForExport,
	getLogBuffer,
} from "../../infra/log";
import { getSocialAccountPath } from "../../infra/paths";
import { getIdentity } from "../social/IdentityService";
import { buildCombinedDayWrappedSnapshot } from "./DayWrappedSnapshotService";
import { classifyImportedMobileActivityDay } from "./MobileActivityClassificationService";

const logger = createLogger({ scope: "LocalMobileBridge" });

const SESSION_TTL_MS = 10 * 60 * 1000;
const REQUEST_SKEW_MS = 15 * 60 * 1000;
const BRIDGE_PORT = 57_885;

type ClaimedSession = {
	deviceId: string;
	deviceName: string;
	platform: "ios";
	signPubKeySpkiDerB64: string;
	dhPubKeySpkiDerB64: string;
};

type PairingSessionRecord = {
	id: string;
	code: string;
	createdAt: number;
	expiresAt: number;
	status: DevicePairingSessionStatus;
	claimedAt: number | null;
	approvedAt: number | null;
	claimed?: ClaimedSession;
};

let server: Server | null = null;
let serverStartPromise: Promise<void> | null = null;
let advertisedBaseUrl: string | null = null;
const pairingSessions = new Map<string, PairingSessionRecord>();

let syncStatus: MobileActivitySyncStatus = {
	inFlight: false,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastError: null,
};

function createPairingCode(): string {
	return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function getCurrentMacAddedAt(): number {
	try {
		const path = getSocialAccountPath();
		if (!existsSync(path)) return Date.now();
		const stat = statSync(path);
		return Math.trunc(stat.birthtimeMs || stat.mtimeMs || Date.now());
	} catch {
		return Date.now();
	}
}

function getAdvertisedHost(): string {
	const interfaces = networkInterfaces();
	const preferredNames = ["en0", "en1", "bridge100", "bridge0", "awdl0"];

	const pickAddress = (name: string): string | null => {
		const entries = interfaces[name];
		if (!entries) return null;
		for (const entry of entries) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (!entry.address.trim()) continue;
			return entry.address;
		}
		return null;
	};

	for (const name of preferredNames) {
		const candidate = pickAddress(name);
		if (candidate) return candidate;
	}

	for (const name of Object.keys(interfaces)) {
		const candidate = pickAddress(name);
		if (candidate) return candidate;
	}

	return "127.0.0.1";
}

function toPublicSession(record: PairingSessionRecord): DevicePairingSession {
	return {
		id: record.id,
		code: record.code,
		pairingUrl:
			advertisedBaseUrl !== null
				? `${advertisedBaseUrl}/pair?sessionId=${encodeURIComponent(record.id)}&code=${encodeURIComponent(record.code)}`
				: record.id,
		status: record.status,
		createdAt: record.createdAt,
		expiresAt: record.expiresAt,
		claimedDeviceName: record.claimed?.deviceName ?? null,
		claimedAt: record.claimedAt,
		approvedAt: record.approvedAt,
	};
}

function pruneSessions(): void {
	const now = Date.now();
	for (const [sessionId, session] of pairingSessions.entries()) {
		if (
			session.status === "approved" &&
			now - session.approvedAt! > SESSION_TTL_MS
		) {
			pairingSessions.delete(sessionId);
			continue;
		}

		if (session.status !== "approved" && now > session.expiresAt) {
			session.status = "expired";
		}

		if (
			session.status === "expired" &&
			now - session.expiresAt > SESSION_TTL_MS
		) {
			pairingSessions.delete(sessionId);
		}
	}
}

function ensureIdentityRegistered(): NonNullable<
	ReturnType<typeof getIdentity>
> {
	const identity = getIdentity();
	if (!identity) {
		throw new Error(
			"Register a Screencap account first to enable iPhone pairing",
		);
	}
	return identity;
}

async function ensureServerStarted(): Promise<void> {
	ensureIdentityRegistered();
	if (server && advertisedBaseUrl) return;
	if (serverStartPromise) {
		await serverStartPromise;
		return;
	}

	serverStartPromise = new Promise<void>((resolve, reject) => {
		const nextServer = createServer((req, res) => {
			void handleRequest(req, res);
		});

		nextServer.once("error", (error) => {
			logger.error("Local mobile bridge failed to start", {
				error: String(error),
			});
			syncStatus = {
				...syncStatus,
				inFlight: false,
				lastError: String(error),
			};
			reject(error);
		});

		nextServer.listen(BRIDGE_PORT, "0.0.0.0", () => {
			const address = nextServer.address();
			if (!address || typeof address === "string") {
				reject(new Error("Failed to resolve local mobile bridge address"));
				return;
			}

			server = nextServer;
			advertisedBaseUrl = `http://${getAdvertisedHost()}:${address.port}`;
			logger.info("Local mobile bridge started", {
				baseUrl: advertisedBaseUrl,
				host: hostname(),
			});
			resolve();
		});
	}).finally(() => {
		serverStartPromise = null;
	});

	await serverStartPromise;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer | string) => {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function sendJson(
	res: ServerResponse,
	statusCode: number,
	payload: unknown,
): void {
	const body = JSON.stringify(payload);
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(body);
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	res.end(body);
}

function parseBodyJson(body: Buffer): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(body.toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function normalizeCategory(
	value: unknown,
): MobileActivityHourBucket["category"] {
	if (value === "Study") return value;
	if (value === "Work") return value;
	if (value === "Leisure") return value;
	if (value === "Chores") return value;
	if (value === "Social") return value;
	return "Unknown";
}

function normalizeBucketApps(value: unknown): MobileActivityBucketApp[] | null {
	if (!Array.isArray(value)) return null;
	return value
		.map<MobileActivityBucketApp | null>((item) => {
			if (!item || typeof item !== "object") return null;
			const obj = item as Record<string, unknown>;
			if (
				typeof obj.name !== "string" ||
				!obj.name.trim() ||
				typeof obj.durationSeconds !== "number" ||
				!Number.isFinite(obj.durationSeconds) ||
				obj.durationSeconds < 0
			) {
				return null;
			}
			const app: MobileActivityBucketApp = {
				name: obj.name,
				durationSeconds: Math.trunc(obj.durationSeconds),
			};
			if (typeof obj.bundleId === "string" && obj.bundleId.trim()) {
				app.bundleId = obj.bundleId;
			}
			if (
				typeof obj.numberOfPickups === "number" &&
				Number.isFinite(obj.numberOfPickups)
			) {
				app.numberOfPickups = Math.trunc(obj.numberOfPickups);
			}
			if (
				typeof obj.numberOfNotifications === "number" &&
				Number.isFinite(obj.numberOfNotifications)
			) {
				app.numberOfNotifications = Math.trunc(obj.numberOfNotifications);
			}
			return app;
		})
		.filter((app): app is MobileActivityBucketApp => app !== null);
}

function normalizeBucketDomains(
	value: unknown,
): MobileActivityBucketDomain[] | null {
	if (!Array.isArray(value)) return null;
	return value
		.map<MobileActivityBucketDomain | null>((item) => {
			if (!item || typeof item !== "object") return null;
			const obj = item as Record<string, unknown>;
			if (
				typeof obj.domain !== "string" ||
				!obj.domain.trim() ||
				typeof obj.durationSeconds !== "number" ||
				!Number.isFinite(obj.durationSeconds) ||
				obj.durationSeconds < 0
			) {
				return null;
			}
			return {
				domain: obj.domain,
				durationSeconds: Math.trunc(obj.durationSeconds),
			} satisfies MobileActivityBucketDomain;
		})
		.filter((domain): domain is MobileActivityBucketDomain => domain !== null);
}

function normalizeBucket(value: unknown): MobileActivityHourBucket | null {
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	if (
		typeof obj.hour !== "number" ||
		!Number.isInteger(obj.hour) ||
		obj.hour < 0 ||
		obj.hour > 23 ||
		typeof obj.durationSeconds !== "number" ||
		!Number.isFinite(obj.durationSeconds) ||
		obj.durationSeconds < 0
	) {
		return null;
	}

	const bucket: MobileActivityHourBucket = {
		hour: obj.hour,
		durationSeconds: Math.trunc(obj.durationSeconds),
		category: normalizeCategory(obj.category),
		appName:
			typeof obj.appName === "string" && obj.appName.trim()
				? obj.appName
				: null,
	};
	if (typeof obj.appBundleId === "string" && obj.appBundleId.trim()) {
		bucket.appBundleId = obj.appBundleId;
	}
	if (typeof obj.domain === "string" && obj.domain.trim()) {
		bucket.domain = obj.domain;
	}
	if (typeof obj.rawCategory === "string" && obj.rawCategory.trim()) {
		bucket.rawCategory = obj.rawCategory;
	}
	const apps = normalizeBucketApps(obj.apps);
	if (apps && apps.length > 0) {
		bucket.apps = apps;
	}
	const domains = normalizeBucketDomains(obj.domains);
	if (domains && domains.length > 0) {
		bucket.domains = domains;
	}
	if (typeof obj.caption === "string" && obj.caption.trim()) {
		bucket.caption = obj.caption;
	}
	if (typeof obj.confidence === "number" && Number.isFinite(obj.confidence)) {
		bucket.confidence = obj.confidence;
	}
	if (
		typeof obj.classificationSource === "string" &&
		obj.classificationSource.trim()
	) {
		bucket.classificationSource = obj.classificationSource;
	}
	return bucket;
}

function normalizeMobileActivityDay(
	value: unknown,
	expectedDeviceId: string,
	expectedDayStartMs: number,
): MobileActivityDay | null {
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	if (
		typeof obj.deviceId !== "string" ||
		obj.deviceId !== expectedDeviceId ||
		typeof obj.dayStartMs !== "number" ||
		!Number.isFinite(obj.dayStartMs) ||
		Math.trunc(obj.dayStartMs) !== expectedDayStartMs ||
		!Array.isArray(obj.buckets)
	) {
		return null;
	}

	const buckets = obj.buckets
		.map(normalizeBucket)
		.filter((bucket): bucket is MobileActivityHourBucket => bucket !== null);

	return {
		deviceId: obj.deviceId,
		deviceName:
			typeof obj.deviceName === "string" && obj.deviceName.trim()
				? obj.deviceName
				: null,
		platform: "ios",
		dayStartMs: Math.trunc(obj.dayStartMs),
		buckets,
		syncedAt:
			typeof obj.syncedAt === "number" && Number.isFinite(obj.syncedAt)
				? Math.trunc(obj.syncedAt)
				: Date.now(),
	};
}

function canonicalPath(pathname: string, search: string): string {
	return search ? `${pathname}${search}` : pathname;
}

function summarizeBridgeLogs(limit = 40): string {
	const entries = getLogBuffer()
		.filter((entry) => entry.scope === "LocalMobileBridge")
		.slice(-limit);
	return formatLogsForExport(entries);
}

function verifySignedRequest(params: {
	method: string;
	path: string;
	body: Buffer;
	headers: IncomingMessage["headers"];
}): { identityUserId: string; device: StoredMobilePairedDevice } {
	const identity = ensureIdentityRegistered();
	const userId = params.headers["x-user-id"];
	const deviceId = params.headers["x-device-id"];
	const ts = params.headers["x-ts"];
	const sig = params.headers["x-sig"];

	if (
		typeof userId !== "string" ||
		typeof deviceId !== "string" ||
		typeof ts !== "string" ||
		typeof sig !== "string"
	) {
		throw new Error("Missing signed-request headers");
	}

	if (userId !== identity.userId) {
		throw new Error("Signed request user mismatch");
	}

	const tsNumber = Number(ts);
	if (
		!Number.isFinite(tsNumber) ||
		Math.abs(Date.now() - tsNumber) > REQUEST_SKEW_MS
	) {
		throw new Error("Signed request timestamp out of range");
	}

	const device = getMobilePairedDevice(deviceId);
	if (!device) {
		throw new Error("Device is not paired with this Mac");
	}

	const canonical = [
		params.method.toUpperCase(),
		params.path,
		ts,
		createHash("sha256").update(params.body).digest("hex"),
	].join("\n");

	const publicKey = createPublicKey({
		key: Buffer.from(device.signPubKeySpkiDerB64, "base64"),
		format: "der",
		type: "spki",
	});
	const isValid = verify(
		null,
		Buffer.from(canonical, "utf8"),
		publicKey,
		Buffer.from(sig, "base64"),
	);
	if (!isValid) {
		throw new Error("Signed request verification failed");
	}

	logger.debug("Verified signed request", {
		method: params.method.toUpperCase(),
		path: params.path,
		deviceId,
		userId,
	});

	return { identityUserId: userId, device };
}

async function handleClaimRequest(
	req: IncomingMessage,
	res: ServerResponse,
	sessionId: string,
): Promise<void> {
	pruneSessions();
	const identity = getIdentity();
	if (!identity) {
		sendJson(res, 503, { error: "Desktop identity is not registered" });
		return;
	}

	const session = pairingSessions.get(sessionId);
	if (!session) {
		sendJson(res, 404, { error: "Pairing session not found" });
		return;
	}
	if (session.status === "expired") {
		sendJson(res, 410, { error: "Pairing session expired" });
		return;
	}

	const body = await readRequestBody(req);
	const payload = parseBodyJson(body);
	if (!payload) {
		sendJson(res, 400, { error: "Invalid JSON body" });
		return;
	}

	const code = typeof payload.code === "string" ? payload.code.trim() : null;
	const deviceName =
		typeof payload.deviceName === "string" ? payload.deviceName.trim() : "";
	const platform = payload.platform;
	const signPubKey =
		typeof payload.signPubKey === "string" ? payload.signPubKey.trim() : "";
	const dhPubKey =
		typeof payload.dhPubKey === "string" ? payload.dhPubKey.trim() : "";

	if (!deviceName || platform !== "ios" || !signPubKey || !dhPubKey) {
		sendJson(res, 400, { error: "Invalid pairing claim payload" });
		return;
	}

	if (code !== session.code) {
		sendJson(res, 403, { error: "Pairing code mismatch" });
		return;
	}

	if (session.status === "approved" && session.claimed) {
		sendJson(res, 200, {
			userId: identity.userId,
			deviceId: session.claimed.deviceId,
			username: identity.username,
		});
		return;
	}

	const now = Date.now();
	const claimedDeviceId = session.claimed?.deviceId ?? randomUUID();
	session.status = "claimed";
	session.claimedAt = now;
	session.claimed = {
		deviceId: claimedDeviceId,
		deviceName,
		platform: "ios",
		signPubKeySpkiDerB64: signPubKey,
		dhPubKeySpkiDerB64: dhPubKey,
	};

	logger.info("iPhone claimed pairing session", {
		sessionId,
		deviceId: claimedDeviceId,
		deviceName,
	});

	sendJson(res, 200, {
		userId: identity.userId,
		deviceId: claimedDeviceId,
		username: identity.username,
	});
}

async function handleUploadRequest(
	req: IncomingMessage,
	res: ServerResponse,
	deviceId: string,
	dayStartMs: number,
	urlPath: string,
): Promise<void> {
	const now = Date.now();
	syncStatus = {
		...syncStatus,
		inFlight: true,
		lastAttemptAt: now,
		lastError: null,
	};

	try {
		const body = await readRequestBody(req);
		const { device } = verifySignedRequest({
			method: req.method ?? "PUT",
			path: urlPath,
			body,
			headers: req.headers,
		});
		if (device.deviceId !== deviceId) {
			throw new Error("Device mismatch");
		}

		const payload = parseBodyJson(body);
		const day = normalizeMobileActivityDay(payload, deviceId, dayStartMs);
		if (!day) {
			throw new Error("Invalid mobile activity day payload");
		}
		const classifiedDay = await classifyImportedMobileActivityDay(day);

		upsertCachedMobileActivityDays([
			{
				...classifiedDay,
				deviceName: classifiedDay.deviceName ?? device.deviceName,
				syncedAt: now,
			},
		]);
		touchMobilePairedDevice(deviceId, now);
		syncStatus = {
			inFlight: false,
			lastAttemptAt: now,
			lastSuccessAt: now,
			lastError: null,
		};
		logger.info("Accepted mobile activity upload", {
			deviceId,
			deviceName: device.deviceName,
			dayStartMs,
			bucketCount: classifiedDay.buckets.length,
			classifiedBucketCount: classifiedDay.buckets.filter(
				(bucket) =>
					typeof bucket.classificationSource === "string" &&
					bucket.classificationSource.startsWith("desktop."),
			).length,
		});
		sendJson(res, 200, { ok: true });
	} catch (error) {
		const message = String(error);
		logger.warn("Local mobile upload rejected", { deviceId, error: message });
		syncStatus = {
			...syncStatus,
			inFlight: false,
			lastError: message,
		};
		sendJson(res, 403, { error: message });
	}
}

async function handleSnapshotRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	urlPath: string,
): Promise<void> {
	try {
		const body = await readRequestBody(req);
		const { device } = verifySignedRequest({
			method: req.method ?? "GET",
			path: urlPath,
			body,
			headers: req.headers,
		});
		touchMobilePairedDevice(device.deviceId, Date.now());
		const dayStartMs = Number(url.searchParams.get("dayStartMs"));
		if (!Number.isFinite(dayStartMs)) {
			sendJson(res, 400, { error: "dayStartMs query param is required" });
			return;
		}

		const normalizedDayStartMs = startOfDay(
			new Date(Math.trunc(dayStartMs)),
		).getTime();
		const cachedDaysForRequestedDay = listCachedMobileActivityDays({
			startDate: normalizedDayStartMs,
			endDate: normalizedDayStartMs,
		}).filter((day) => day.deviceId === device.deviceId);
		const snapshot = buildCombinedDayWrappedSnapshot(normalizedDayStartMs);
		logger.info("Built day wrapped snapshot for iPhone", {
			deviceId: device.deviceId,
			dayStartMs: normalizedDayStartMs,
			cachedDaysForRequestedDay: cachedDaysForRequestedDay.length,
			requestedDayBucketCount:
				cachedDaysForRequestedDay[0]?.buckets.length ?? null,
			sourceSummary: snapshot.sourceSummary,
			activeSlotCount: snapshot.slots.filter((slot) => slot.count > 0).length,
		});
		sendJson(res, 200, snapshot);
	} catch (error) {
		const message = String(error);
		logger.warn("Local mobile snapshot request rejected", { error: message });
		sendJson(res, 403, { error: message });
	}
}

async function handleBridgeDiagnosticsRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	urlPath: string,
): Promise<void> {
	try {
		const body = await readRequestBody(req);
		const { device, identityUserId } = verifySignedRequest({
			method: req.method ?? "GET",
			path: urlPath,
			body,
			headers: req.headers,
		});
		const dayStartMs = Number(url.searchParams.get("dayStartMs"));
		if (!Number.isFinite(dayStartMs)) {
			sendJson(res, 400, { error: "dayStartMs query param is required" });
			return;
		}
		touchMobilePairedDevice(device.deviceId, Date.now());
		const normalizedDayStartMs = startOfDay(
			new Date(Math.trunc(dayStartMs)),
		).getTime();
		const probeToken = url.searchParams.get("probeToken");
		const snapshot = buildCombinedDayWrappedSnapshot(normalizedDayStartMs);
		const events = getEvents({
			startDate: normalizedDayStartMs,
			endDate: endOfDay(new Date(normalizedDayStartMs)).getTime(),
			dismissed: false,
		});
		const cachedDaysForDevice = listCachedMobileActivityDays({}).filter(
			(day) => day.deviceId === device.deviceId,
		);
		const cachedDaysForRequestedDay = cachedDaysForDevice.filter(
			(day) => day.dayStartMs === normalizedDayStartMs,
		);
		const latestCachedDay = cachedDaysForDevice[0] ?? null;
		const cachedDayStartMsForDevice = cachedDaysForDevice
			.slice(0, 7)
			.map((day) => day.dayStartMs);
		const requestedDayBucketCount =
			cachedDaysForRequestedDay[0]?.buckets.length ?? null;
		const bridgeLogTail = summarizeBridgeLogs();
		logger.info("Bridge diagnostics requested", {
			deviceId: device.deviceId,
			dayStartMs: normalizedDayStartMs,
			probeToken,
			cachedDayStartMsForDevice,
			requestedDayBucketCount,
			eventCount: events.length,
			cachedDaysForRequestedDay: cachedDaysForRequestedDay.length,
			activeSlotCount: snapshot.slots.filter((slot) => slot.count > 0).length,
		});
		sendJson(res, 200, {
			ok: true,
			requestedDayStartMs: normalizedDayStartMs,
			probeToken,
			echoedProbeToken: probeToken,
			serverNowMs: Date.now(),
			advertisedBaseURL: advertisedBaseUrl,
			userId: identityUserId,
			username: ensureIdentityRegistered().username,
			pairedDeviceId: device.deviceId,
			pairedDeviceName: device.deviceName,
			cachedDaysForDevice: cachedDaysForDevice.length,
			cachedDaysForRequestedDay: cachedDaysForRequestedDay.length,
			cachedDayStartMsForDevice,
			latestCachedDayStartMs: latestCachedDay?.dayStartMs ?? null,
			latestCachedDaySyncedAt: latestCachedDay?.syncedAt ?? null,
			requestedDayBucketCount,
			eventCountForRequestedDay: events.length,
			snapshotSourceSummary: snapshot.sourceSummary,
			activeSlotCount: snapshot.slots.filter((slot) => slot.count > 0).length,
			bridgeLogTail,
		});
	} catch (error) {
		const message = String(error);
		logger.warn("Bridge diagnostics request rejected", { error: message });
		sendJson(res, 403, { error: message });
	}
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	try {
		const host = req.headers.host ?? "127.0.0.1";
		const url = new URL(req.url ?? "/", `http://${host}`);
		const path = url.pathname;
		const fullPath = canonicalPath(url.pathname, url.search);
		logger.debug("Received bridge request", {
			method: req.method,
			path,
			search: url.search,
		});

		if (req.method === "GET" && path === "/pair") {
			sendText(
				res,
				200,
				"Screencap pairing bridge is running. Scan this link from the iPhone app or paste it into the pairing field.",
			);
			return;
		}

		const claimMatch = path.match(
			/^\/api\/device-pairing-sessions\/([^/]+)\/claim$/,
		);
		if (req.method === "POST" && claimMatch) {
			await handleClaimRequest(req, res, decodeURIComponent(claimMatch[1]));
			return;
		}

		if (req.method === "GET" && path === "/api/me/day-wrapped-snapshot") {
			await handleSnapshotRequest(req, res, url, fullPath);
			return;
		}

		if (req.method === "GET" && path === "/api/me/bridge-diagnostics") {
			await handleBridgeDiagnosticsRequest(req, res, url, fullPath);
			return;
		}

		const uploadMatch = path.match(
			/^\/api\/me\/mobile-activity-days\/([^/]+)\/(\d+)$/,
		);
		if (req.method === "PUT" && uploadMatch) {
			await handleUploadRequest(
				req,
				res,
				decodeURIComponent(uploadMatch[1]),
				Number(uploadMatch[2]),
				fullPath,
			);
			return;
		}

		sendJson(res, 404, { error: "Not found" });
	} catch (error) {
		logger.error("Local mobile bridge request failed", {
			error: String(error),
			method: req.method,
			url: req.url,
		});
		sendJson(res, 500, { error: "Internal server error" });
	}
}

export async function createLocalDevicePairingSession(): Promise<DevicePairingSession> {
	await ensureServerStarted();
	pruneSessions();

	const now = Date.now();
	const session: PairingSessionRecord = {
		id: randomUUID(),
		code: createPairingCode(),
		createdAt: now,
		expiresAt: now + SESSION_TTL_MS,
		status: "pending",
		claimedAt: null,
		approvedAt: null,
	};
	pairingSessions.set(session.id, session);
	return toPublicSession(session);
}

export async function getLocalDevicePairingSession(
	sessionId: string,
): Promise<DevicePairingSession | null> {
	await ensureServerStarted();
	pruneSessions();
	const session = pairingSessions.get(sessionId);
	return session ? toPublicSession(session) : null;
}

export async function approveLocalDevicePairingSession(
	sessionId: string,
): Promise<DevicePairingSession | null> {
	await ensureServerStarted();
	pruneSessions();

	const session = pairingSessions.get(sessionId);
	if (!session) return null;
	if (!session.claimed) return toPublicSession(session);
	if (session.status === "expired") return toPublicSession(session);

	const now = Date.now();
	session.status = "approved";
	session.approvedAt = now;
	upsertMobilePairedDevice({
		deviceId: session.claimed.deviceId,
		deviceName: session.claimed.deviceName,
		platform: "ios",
		signPubKeySpkiDerB64: session.claimed.signPubKeySpkiDerB64,
		dhPubKeySpkiDerB64: session.claimed.dhPubKeySpkiDerB64,
		addedAt: session.claimedAt ?? now,
		lastSeenAt: now,
	});
	logger.info("Approved paired iPhone", {
		sessionId,
		deviceId: session.claimed.deviceId,
		deviceName: session.claimed.deviceName,
	});
	return toPublicSession(session);
}

function buildCurrentMacDevice(): PairedDevice | null {
	const identity = getIdentity();
	if (!identity) return null;
	return {
		deviceId: identity.deviceId,
		deviceName: hostname(),
		platform: "macos",
		addedAt: getCurrentMacAddedAt(),
		lastSeenAt: Date.now(),
		isCurrent: true,
	};
}

export async function listLocalPairedDevices(): Promise<PairedDevice[]> {
	await ensureServerStarted();

	const currentMac = buildCurrentMacDevice();
	const mobileDevices = listMobilePairedDevices().map<PairedDevice>(
		(device) => ({
			deviceId: device.deviceId,
			deviceName: device.deviceName,
			platform: device.platform,
			addedAt: device.addedAt,
			lastSeenAt: device.lastSeenAt,
			isCurrent: false,
		}),
	);

	return currentMac ? [currentMac, ...mobileDevices] : mobileDevices;
}

export async function revokeLocalPairedDevice(deviceId: string): Promise<void> {
	await ensureServerStarted();
	const identity = ensureIdentityRegistered();
	if (deviceId === identity.deviceId) {
		throw new Error("Cannot revoke the current Mac device");
	}

	deleteMobilePairedDevice(deviceId);
	deleteCachedMobileActivityDaysByDeviceId(deviceId);
	for (const session of pairingSessions.values()) {
		if (session.claimed?.deviceId === deviceId) {
			session.status = "expired";
		}
	}
	logger.info("Revoked paired iPhone", { deviceId });
}

export function listLocalMobileActivityDays(
	options: GetMobileActivityDaysOptions,
): MobileActivityDay[] {
	return listCachedMobileActivityDays(options);
}

export async function syncLocalMobileActivityDays(
	options?: GetMobileActivityDaysOptions,
): Promise<{ count: number }> {
	if (!getIdentity()) {
		syncStatus = {
			inFlight: false,
			lastAttemptAt: null,
			lastSuccessAt: null,
			lastError: null,
		};
		return { count: 0 };
	}

	await ensureServerStarted();
	const now = Date.now();
	syncStatus = {
		inFlight: false,
		lastAttemptAt: now,
		lastSuccessAt: syncStatus.lastSuccessAt ?? now,
		lastError: null,
	};
	return {
		count: listCachedMobileActivityDays(options ?? {}).length,
	};
}

export function getLocalMobileActivitySyncStatus(): MobileActivitySyncStatus {
	return { ...syncStatus };
}

export function startLocalMobileBridge(): void {
	if (!getIdentity()) return;
	void ensureServerStarted().catch((error) => {
		const message = String(error);
		logger.warn("Failed to start local mobile bridge", { error: message });
		syncStatus = {
			...syncStatus,
			inFlight: false,
			lastError: message,
		};
	});
}

export function stopLocalMobileBridge(): void {
	if (!server) return;
	server.close();
	server = null;
	advertisedBaseUrl = null;
	logger.info("Stopped local mobile bridge");
}
