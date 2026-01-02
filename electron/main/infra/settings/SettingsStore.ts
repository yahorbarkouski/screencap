import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { safeStorage } from "electron";
import type { Settings } from "../../../shared/types";
import { createLogger } from "../log";
import { getSettingsPath } from "../paths";

const logger = createLogger({ scope: "SettingsStore" });

const ONBOARDING_VERSION = 1;

const DEFAULT_SETTINGS: Settings = {
	apiKey: null,
	captureInterval: 5,
	retentionDays: 30,
	excludedApps: [],
	launchAtLogin: false,
	automationRules: { apps: {}, hosts: {} },
	onboarding: { version: ONBOARDING_VERSION, completedAt: null },
	shortcuts: {
		captureNow: "Command+Shift+O",
		captureProjectProgress: "Command+Shift+P",
	},
	llmEnabled: true,
	allowVisionUploads: true,
	localLlmEnabled: false,
	localLlmBaseUrl: "http://localhost:11434/v1",
	localLlmModel: "llama3.2",
	sessionSummaryEnabled: false,
};

export { ONBOARDING_VERSION };

let cachedSettings: Settings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000;

function isEncryptionAvailable(): boolean {
	return safeStorage.isEncryptionAvailable();
}

function encryptApiKey(apiKey: string | null): string | null {
	if (!apiKey || !isEncryptionAvailable()) return apiKey;
	const encrypted = safeStorage.encryptString(apiKey);
	return encrypted.toString("base64");
}

function decryptApiKey(encrypted: string | null): string | null {
	if (!encrypted || !isEncryptionAvailable()) return encrypted;
	try {
		return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
	} catch {
		logger.warn("Failed to decrypt API key, returning null");
		return null;
	}
}

function migrateExcludedApps(settings: Settings): {
	settings: Settings;
	changed: boolean;
} {
	if (!settings.excludedApps || settings.excludedApps.length === 0) {
		return { settings, changed: false };
	}

	const unique = Array.from(new Set(settings.excludedApps)).filter(Boolean);
	if (unique.length === 0) {
		if (settings.excludedApps.length === 0) return { settings, changed: false };
		return { settings: { ...settings, excludedApps: [] }, changed: true };
	}

	let changed = false;
	const apps = { ...(settings.automationRules?.apps ?? {}) };

	for (const bundleId of unique) {
		const prev = apps[bundleId] ?? {};
		if (prev.capture !== "skip") {
			apps[bundleId] = { ...prev, capture: "skip" };
			changed = true;
		}
	}

	if (settings.excludedApps.length > 0) {
		changed = true;
	}

	const migrated: Settings = {
		...settings,
		excludedApps: [],
		automationRules: {
			...settings.automationRules,
			apps,
		},
	};

	return { settings: migrated, changed };
}

export function getSettings(): Settings {
	const now = Date.now();
	if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
		return cachedSettings;
	}

	const path = getSettingsPath();
	if (!existsSync(path)) {
		cachedSettings = { ...DEFAULT_SETTINGS };
		cacheTimestamp = now;
		return cachedSettings;
	}

	try {
		const data = readFileSync(path, "utf-8");
		const parsed = JSON.parse(data) as Settings;
		const settings: Settings = {
			...DEFAULT_SETTINGS,
			...parsed,
			apiKey: decryptApiKey(parsed.apiKey),
		};

		const migrated = migrateExcludedApps(settings);
		if (migrated.changed) {
			setSettings(migrated.settings);
			return migrated.settings;
		}

		cachedSettings = settings;
		cacheTimestamp = now;
		return settings;
	} catch (error) {
		logger.error("Failed to read settings, using defaults", error);
		cachedSettings = { ...DEFAULT_SETTINGS };
		cacheTimestamp = now;
		return cachedSettings;
	}
}

export function setSettings(settings: Settings): void {
	const toSave: Settings = {
		...settings,
		apiKey: encryptApiKey(settings.apiKey),
	};

	const path = getSettingsPath();
	writeFileSync(path, JSON.stringify(toSave, null, 2));

	cachedSettings = settings;
	cacheTimestamp = Date.now();
	logger.info("Settings saved");
}

export function getApiKey(): string | null {
	return getSettings().apiKey;
}

export function getCaptureInterval(): number {
	return getSettings().captureInterval;
}

export function invalidateCache(): void {
	cachedSettings = null;
	cacheTimestamp = 0;
}
