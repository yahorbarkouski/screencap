import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { net } from "electron";
import {
	getFaviconPath,
	upsertFavicon,
} from "../../infra/db/repositories/FaviconRepository";
import { getFaviconsDir } from "../../infra/paths";
import { broadcastEventsChanged } from "../../infra/windows";

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1_000_000;

function isIpV4(hostname: string): boolean {
	const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!m) return false;
	return m.slice(1).every((octet) => {
		const n = Number(octet);
		return Number.isInteger(n) && n >= 0 && n <= 255;
	});
}

function isBlockedHostname(hostname: string): boolean {
	const h = hostname.trim().toLowerCase();
	if (h === "localhost" || h === "::1") return true;

	if (!isIpV4(h)) return false;
	const [a, b] = h.split(".").map(Number);

	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;

	return false;
}

function toSafeHttpUrl(input: string): string | null {
	try {
		const u = new URL(input);
		if (u.protocol !== "https:" && u.protocol !== "http:") return null;
		if (isBlockedHostname(u.hostname)) return null;
		return u.toString();
	} catch {
		return null;
	}
}

async function fetchWithTimeout(url: string): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await net.fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeHost(host: string): string {
	return host.trim().toLowerCase();
}

function safeFileBase(host: string): string {
	return normalizeHost(host).replace(/[^a-z0-9.-]/g, "_");
}

function inferExtension(contentType: string | null, url: string): string {
	const ct = (contentType ?? "").toLowerCase();
	if (ct.includes("svg")) return "svg";
	if (ct.includes("png")) return "png";
	if (ct.includes("webp")) return "webp";
	if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
	if (ct.includes("gif")) return "gif";
	if (ct.includes("icon")) return "ico";

	const m = url.toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|#|$)/);
	return m?.[1] ?? "ico";
}

function isValidIconResponse(contentType: string | null): boolean {
	const ct = (contentType ?? "").toLowerCase();
	return ct.startsWith("image/");
}

function extractIconUrls(html: string, baseUrl: string): string[] {
	const out: string[] = [];
	const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

	for (const tag of linkTags) {
		const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
		const rel = relMatch?.[1]?.toLowerCase() ?? "";
		if (!rel.includes("icon")) continue;

		const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
		const href = hrefMatch?.[1] ?? "";
		if (!href || href.startsWith("data:")) continue;

		try {
			out.push(new URL(href, baseUrl).href);
		} catch {}
	}

	return out;
}

async function tryDownloadIcon(
	url: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
	const safeUrl = toSafeHttpUrl(url);
	if (!safeUrl) return null;

	try {
		const res = await fetchWithTimeout(safeUrl);
		if (!res.ok) return null;

		const contentType = res.headers.get("content-type");
		if (!isValidIconResponse(contentType)) return null;

		const ab = await res.arrayBuffer();
		if (ab.byteLength === 0 || ab.byteLength > 1_500_000) return null;

		return { bytes: new Uint8Array(ab), contentType };
	} catch {
		return null;
	}
}

async function discoverCandidateUrls(
	host: string,
	urlCanonical: string | null,
): Promise<string[]> {
	const candidates: string[] = [];

	if (urlCanonical) {
		try {
			const u = new URL(urlCanonical);
			candidates.push(new URL("/favicon.ico", u.origin).href);
			candidates.push(u.origin);
		} catch {}
	}

	candidates.push(`https://${host}/favicon.ico`);
	candidates.push(`http://${host}/favicon.ico`);
	candidates.push(`https://${host}`);
	candidates.push(`http://${host}`);

	const firstPage = candidates.find((u) => !u.endsWith("/favicon.ico")) ?? null;
	if (!firstPage) return candidates;

	try {
		const safeFirstPage = toSafeHttpUrl(firstPage);
		if (!safeFirstPage) return candidates;

		const res = await fetchWithTimeout(safeFirstPage);
		if (!res.ok) return candidates;
		const ct = res.headers.get("content-type") ?? "";
		if (!ct.toLowerCase().includes("text/html")) return candidates;

		const contentLength = Number(res.headers.get("content-length") ?? "0");
		if (contentLength > MAX_HTML_BYTES) return candidates;

		const html = await res.text();
		if (html.length > MAX_HTML_BYTES) return candidates;

		const discovered = extractIconUrls(html, firstPage);
		return [...discovered, ...candidates];
	} catch {
		return candidates;
	}
}

const inflight = new Map<string, Promise<string | null>>();

export async function ensureFavicon(
	host: string,
	urlCanonical: string | null,
): Promise<string | null> {
	const key = normalizeHost(host);
	const existing = getFaviconPath(key);
	if (existing && existsSync(existing)) return existing;

	const inProgress = inflight.get(key);
	if (inProgress) return inProgress;

	const task = (async () => {
		const urls = await discoverCandidateUrls(key, urlCanonical);

		for (const url of urls) {
			const result = await tryDownloadIcon(url);
			if (!result) continue;

			const ext = inferExtension(result.contentType, url);
			const filePath = join(getFaviconsDir(), `${safeFileBase(key)}.${ext}`);

			try {
				writeFileSync(filePath, result.bytes);
			} catch {
				continue;
			}

			upsertFavicon(key, filePath, Date.now());
			broadcastEventsChanged();
			return filePath;
		}

		return null;
	})();

	inflight.set(key, task);
	try {
		return await task;
	} finally {
		inflight.delete(key);
	}
}
