import {
	createHash,
	createPrivateKey,
	generateKeyPairSync,
	sign,
} from "node:crypto";
import type { BodyInit } from "undici-types";
import { createLogger } from "../../infra/log";
import { getSocialApiBaseUrl } from "./config";
import {
	loadIdentity,
	type StoredPrivateKeys,
	saveIdentity,
} from "./IdentityStore";

const logger = createLogger({ scope: "IdentityService" });

export type SocialIdentity = {
	userId: string;
	deviceId: string;
	username: string;
	signPubKeySpkiDerB64: string;
	dhPubKeySpkiDerB64: string;
};

type Loaded = {
	identity: SocialIdentity;
	privateKeys: StoredPrivateKeys;
};

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function canonicalString(params: {
	method: string;
	path: string;
	ts: string;
	bodyHashHex: string;
}): string {
	return `${params.method.toUpperCase()}\n${params.path}\n${params.ts}\n${params.bodyHashHex}`;
}

function encodeBody(body: unknown): Uint8Array {
	if (body === undefined || body === null) return new Uint8Array();
	if (typeof body === "string") return Buffer.from(body, "utf8");
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	throw new Error("Unsupported request body type for signedFetch");
}

function load(): Loaded | null {
	const loaded = loadIdentity();
	if (!loaded) return null;
	return { identity: loaded.identity, privateKeys: loaded.privateKeys };
}

export function getIdentity(): SocialIdentity | null {
	return load()?.identity ?? null;
}

export function getDhPrivateKeyPkcs8DerB64(): string {
	const loaded = load();
	if (!loaded) {
		throw new Error("Identity not registered");
	}
	return loaded.privateKeys.dhPrivKeyPkcs8DerB64;
}

export function getDhPublicKeySpkiDerB64(): string {
	const loaded = load();
	if (!loaded) {
		throw new Error("Identity not registered");
	}
	return loaded.identity.dhPubKeySpkiDerB64;
}

export async function registerUsername(
	username: string,
): Promise<SocialIdentity> {
	const existing = load();
	if (existing) {
		if (existing.identity.username !== username.trim().toLowerCase()) {
			logger.warn("Identity already registered with different username", {
				current: existing.identity.username,
				requested: username,
			});
		}
		return existing.identity;
	}

	const signKeys = generateKeyPairSync("ed25519");
	const dhKeys = generateKeyPairSync("x25519");

	const signPubKeySpkiDerB64 = Buffer.from(
		signKeys.publicKey.export({ type: "spki", format: "der" }) as Buffer,
	).toString("base64");
	const signPrivKeyPkcs8DerB64 = Buffer.from(
		signKeys.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
	).toString("base64");

	const dhPubKeySpkiDerB64 = Buffer.from(
		dhKeys.publicKey.export({ type: "spki", format: "der" }) as Buffer,
	).toString("base64");
	const dhPrivKeyPkcs8DerB64 = Buffer.from(
		dhKeys.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
	).toString("base64");

	const normalized = username.trim().toLowerCase();
	const baseUrl = getSocialApiBaseUrl();
	const response = await fetch(`${baseUrl}/api/users/register`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: normalized,
			signPubKey: signPubKeySpkiDerB64,
			dhPubKey: dhPubKeySpkiDerB64,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Register failed: ${response.status} ${text}`);
	}

	const result = (await response.json()) as {
		userId: string;
		deviceId: string;
		username: string;
	};

	const identity: SocialIdentity = {
		userId: result.userId,
		deviceId: result.deviceId,
		username: result.username,
		signPubKeySpkiDerB64,
		dhPubKeySpkiDerB64,
	};

	saveIdentity({
		...identity,
		privateKeys: { signPrivKeyPkcs8DerB64, dhPrivKeyPkcs8DerB64 },
	});

	logger.info("Registered identity", {
		userId: identity.userId,
		deviceId: identity.deviceId,
	});
	return identity;
}

export async function signedFetch(
	path: string,
	init: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<Response> {
	const loaded = load();
	if (!loaded) {
		throw new Error("Identity not registered");
	}

	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const ts = String(Date.now());
	const bodyBytes = encodeBody(init.body);
	const bodyHashHex = sha256Hex(bodyBytes);
	const canonical = canonicalString({
		method: init.method,
		path: normalizedPath,
		ts,
		bodyHashHex,
	});

	const privKey = createPrivateKey({
		key: Buffer.from(loaded.privateKeys.signPrivKeyPkcs8DerB64, "base64"),
		format: "der",
		type: "pkcs8",
	});

	const signature = sign(
		null,
		Buffer.from(canonical, "utf8"),
		privKey,
	).toString("base64");

	const headers: Record<string, string> = {
		...(init.headers ?? {}),
		"x-user-id": loaded.identity.userId,
		"x-device-id": loaded.identity.deviceId,
		"x-ts": ts,
		"x-sig": signature,
	};

	const baseUrl = getSocialApiBaseUrl();
	return await fetch(`${baseUrl}${normalizedPath}`, {
		method: init.method,
		headers,
		body: init.body as BodyInit | undefined,
	});
}

export async function syncAvatarSettings(avatarSettings: {
	pattern: string;
	backgroundColor: string;
	foregroundColor: string;
}): Promise<void> {
	const res = await signedFetch("/api/me", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ avatarSettings }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`syncAvatarSettings failed: ${res.status} ${text}`);
	}
}
