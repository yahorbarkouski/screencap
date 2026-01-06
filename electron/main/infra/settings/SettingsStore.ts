import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { safeStorage } from "electron";
import { z } from "zod";
import type { Settings } from "../../../shared/types";
import { createLogger } from "../log";
import { getSettingsPath } from "../paths";

const logger = createLogger({ scope: "SettingsStore" });

const ONBOARDING_VERSION = 1;

const DEFAULT_BACKEND_URL = "https://screencap-frontend.vercel.app";

const DEFAULT_SETTINGS: Settings = {
	apiKey: null,
	captureInterval: 5,
	retentionDays: 30,
	excludedApps: [],
	launchAtLogin: false,
	automationRules: { apps: {}, hosts: {} },
	onboarding: {
		version: ONBOARDING_VERSION,
		completedAt: null,
		lastStep: null,
	},
	shortcuts: {
		captureNow: "Command+Shift+O",
		captureProjectProgress: "Command+Shift+P",
		endOfDay: "Command+Shift+E",
	},
	sharing: {
		includeAppName: true,
		includeWindowTitle: false,
		includeContentInfo: true,
	},
	social: {
		dayWrapped: {
			enabled: false,
			includeApps: false,
			includeAddiction: false,
		},
		ui: {
			hideDayWrappedSharingDisabledWarning: false,
		},
	},
	avatar: {
		pattern: "ascii",
		backgroundColor: "#0a0a0a",
		foregroundColor: "#ffffff",
		asciiChar: "@",
	},
	llmEnabled: true,
	allowVisionUploads: true,
	cloudLlmModel: "openai/gpt-5",
	localLlmEnabled: false,
	localLlmBaseUrl: "http://localhost:11434/v1",
	localLlmModel: "llama3.2",
	autoDetectProgress: false,
	showDominantWebsites: false,
	customBackendEnabled: false,
	customBackendUrl: "",
};

export { DEFAULT_BACKEND_URL };

const zNonEmptyString = z.string().min(1);
const zLimitedString = (max: number) => zNonEmptyString.max(max);
const zNonNegativeInt = z.number().int().nonnegative();
const zPositiveInt = z.number().int().positive();

const zAutomationRule = z
	.object({
		capture: z.enum(["allow", "skip"]).optional(),
		llm: z.enum(["allow", "skip"]).optional(),
		category: z
			.enum(["Study", "Work", "Leisure", "Chores", "Social", "Unknown"])
			.optional(),
		tags: z.array(zLimitedString(200)).max(100).optional(),
		projectMode: z.enum(["auto", "skip", "force"]).optional(),
		project: zLimitedString(500).optional(),
	})
	.strip()
	.catch({});

const zAutomationRules = z
	.object({
		apps: z.record(zLimitedString(500), zAutomationRule).catch({}),
		hosts: z.record(zLimitedString(500), zAutomationRule).catch({}),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.automationRules);

const zOnboardingState = z
	.object({
		version: zNonNegativeInt.catch(ONBOARDING_VERSION),
		completedAt: z.number().int().nullable().catch(null),
		lastStep: zLimitedString(50).nullable().catch(null),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.onboarding);

const zShortcutAccelerator = zLimitedString(200).nullable();

const zShortcutSettings = z
	.object({
		captureNow: zShortcutAccelerator.catch(
			DEFAULT_SETTINGS.shortcuts.captureNow,
		),
		captureProjectProgress: zShortcutAccelerator.catch(
			DEFAULT_SETTINGS.shortcuts.captureProjectProgress,
		),
		endOfDay: zShortcutAccelerator.catch(DEFAULT_SETTINGS.shortcuts.endOfDay),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.shortcuts);

const zSharingSettings = z
	.object({
		includeAppName: z.boolean().catch(DEFAULT_SETTINGS.sharing.includeAppName),
		includeWindowTitle: z
			.boolean()
			.catch(DEFAULT_SETTINGS.sharing.includeWindowTitle),
		includeContentInfo: z
			.boolean()
			.catch(DEFAULT_SETTINGS.sharing.includeContentInfo),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.sharing);

const zDayWrappedSharingSettings = z
	.object({
		enabled: z.boolean().catch(DEFAULT_SETTINGS.social.dayWrapped.enabled),
		includeApps: z
			.boolean()
			.catch(DEFAULT_SETTINGS.social.dayWrapped.includeApps),
		includeAddiction: z
			.boolean()
			.catch(DEFAULT_SETTINGS.social.dayWrapped.includeAddiction),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.social.dayWrapped);

const zSocialUiSettings = z
	.object({
		hideDayWrappedSharingDisabledWarning: z
			.boolean()
			.catch(DEFAULT_SETTINGS.social.ui.hideDayWrappedSharingDisabledWarning),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.social.ui);

const zSocialSharingSettings = z
	.object({
		dayWrapped: zDayWrappedSharingSettings,
		ui: zSocialUiSettings,
	})
	.strip()
	.catch(DEFAULT_SETTINGS.social);

const zAvatarSettings = z
	.object({
		pattern: z.enum(["ascii"]).catch(DEFAULT_SETTINGS.avatar.pattern),
		backgroundColor: z
			.string()
			.max(100)
			.catch(DEFAULT_SETTINGS.avatar.backgroundColor),
		foregroundColor: z
			.string()
			.max(100)
			.catch(DEFAULT_SETTINGS.avatar.foregroundColor),
		asciiChar: z
			.string()
			.trim()
			.min(1)
			.max(1)
			.regex(/^[\x21-\x7E]$/)
			.catch(DEFAULT_SETTINGS.avatar.asciiChar),
	})
	.strip()
	.catch(DEFAULT_SETTINGS.avatar);

const settingsFileSchema: z.ZodType<Settings, z.ZodTypeDef, unknown> = z
	.object({
		apiKey: z
			.string()
			.min(1)
			.max(5000)
			.nullable()
			.catch(DEFAULT_SETTINGS.apiKey),
		captureInterval: zPositiveInt
			.max(1440)
			.catch(DEFAULT_SETTINGS.captureInterval),
		retentionDays: zPositiveInt.max(3650).catch(DEFAULT_SETTINGS.retentionDays),
		excludedApps: z
			.array(zLimitedString(500))
			.max(5000)
			.catch(DEFAULT_SETTINGS.excludedApps),
		launchAtLogin: z.boolean().catch(DEFAULT_SETTINGS.launchAtLogin),
		automationRules: zAutomationRules,
		onboarding: zOnboardingState,
		shortcuts: zShortcutSettings,
		sharing: zSharingSettings,
		social: zSocialSharingSettings,
		avatar: zAvatarSettings,
		llmEnabled: z.boolean().catch(DEFAULT_SETTINGS.llmEnabled),
		allowVisionUploads: z.boolean().catch(DEFAULT_SETTINGS.allowVisionUploads),
		cloudLlmModel: zLimitedString(500).catch(DEFAULT_SETTINGS.cloudLlmModel),
		localLlmEnabled: z.boolean().catch(DEFAULT_SETTINGS.localLlmEnabled),
		localLlmBaseUrl: zLimitedString(2000).catch(
			DEFAULT_SETTINGS.localLlmBaseUrl,
		),
		localLlmModel: zLimitedString(500).catch(DEFAULT_SETTINGS.localLlmModel),
		autoDetectProgress: z.boolean().catch(DEFAULT_SETTINGS.autoDetectProgress),
		showDominantWebsites: z
			.boolean()
			.catch(DEFAULT_SETTINGS.showDominantWebsites),
		customBackendEnabled: z
			.boolean()
			.catch(DEFAULT_SETTINGS.customBackendEnabled),
		customBackendUrl: z
			.string()
			.max(2000)
			.catch(DEFAULT_SETTINGS.customBackendUrl),
	})
	.strip()
	.catch(DEFAULT_SETTINGS);

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
		const parsed = settingsFileSchema.parse(JSON.parse(data) as unknown);
		const settings: Settings = {
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
