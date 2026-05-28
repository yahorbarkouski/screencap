import { describe, expect, it } from "vitest";
import type { Settings } from "../../../shared/types";
import { ipcSetSettingsArgs } from "../validation";

const VALID_SETTINGS: Settings = {
	apiKey: "test-api-key",
	captureInterval: 5,
	retentionDays: 30,
	excludedApps: [],
	launchAtLogin: false,
	automationRules: { apps: {}, hosts: {} },
	onboarding: { version: 1, completedAt: null, lastStep: null },
	shortcuts: {
		captureNow: "Command+Shift+O",
		captureProjectProgress: "Command+Shift+P",
		endOfDay: "Command+Shift+E",
	},
	llmEnabled: true,
	allowVisionUploads: true,
	cloudLlmModel: "openai/gpt-5",
	localLlmEnabled: false,
	localLlmBaseUrl: "http://localhost:11434/v1",
	localLlmModel: "llama3.2",
	autoDetectProgress: true,
	showDominantWebsites: false,
};

describe("ipcSetSettingsArgs", () => {
	it("validates a complete Settings object", () => {
		const result = ipcSetSettingsArgs.safeParse([VALID_SETTINGS]);
		expect(result.success).toBe(true);
	});

	it("ensures all Settings keys are covered by the schema", () => {
		const settingsKeys = Object.keys(VALID_SETTINGS).sort();
		const result = ipcSetSettingsArgs.safeParse([VALID_SETTINGS]);

		expect(result.success).toBe(true);
		if (result.success) {
			const schemaKeys = Object.keys(result.data[0]).sort();
			expect(schemaKeys).toEqual(settingsKeys);
		}
	});

	it("rejects objects with unknown keys (strict mode)", () => {
		const settingsWithExtraKey = {
			...VALID_SETTINGS,
			unknownField: "should fail",
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithExtraKey]);

		expect(result.success).toBe(false);
		if (!result.success) {
			const hasUnrecognizedKeyError = result.error.issues.some(
				(issue) => issue.code === "unrecognized_keys",
			);
			expect(hasUnrecognizedKeyError).toBe(true);
		}
	});

	it("rejects objects with missing required keys", () => {
		const { shortcuts: _, ...settingsWithoutShortcuts } = VALID_SETTINGS;
		const result = ipcSetSettingsArgs.safeParse([settingsWithoutShortcuts]);

		expect(result.success).toBe(false);
	});

	it("validates shortcuts settings structure", () => {
		const settingsWithInvalidShortcuts = {
			...VALID_SETTINGS,
			shortcuts: { captureNow: 123 },
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithInvalidShortcuts]);

		expect(result.success).toBe(false);
	});

	it("validates automation rules structure", () => {
		const settingsWithInvalidRules = {
			...VALID_SETTINGS,
			automationRules: { apps: "not an object" },
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithInvalidRules]);

		expect(result.success).toBe(false);
	});

	it("validates onboarding state structure", () => {
		const settingsWithInvalidOnboarding = {
			...VALID_SETTINGS,
			onboarding: { version: "not a number" },
		};
		const result = ipcSetSettingsArgs.safeParse([
			settingsWithInvalidOnboarding,
		]);

		expect(result.success).toBe(false);
	});

	it("validates number constraints", () => {
		const settingsWithInvalidInterval = {
			...VALID_SETTINGS,
			captureInterval: 0,
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithInvalidInterval]);

		expect(result.success).toBe(false);
	});

	it("allows null apiKey", () => {
		const settingsWithNullApiKey = {
			...VALID_SETTINGS,
			apiKey: null,
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithNullApiKey]);

		expect(result.success).toBe(true);
	});

	it("allows null shortcut accelerators", () => {
		const settingsWithNullShortcuts = {
			...VALID_SETTINGS,
			shortcuts: {
				captureNow: null,
				captureProjectProgress: null,
				endOfDay: null,
			},
		};
		const result = ipcSetSettingsArgs.safeParse([settingsWithNullShortcuts]);

		expect(result.success).toBe(true);
	});
});
