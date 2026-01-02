import { z } from "zod";

const zNonEmptyString = z.string().min(1);
const zLimitedString = (max: number) => z.string().min(1).max(max);
const zNonNegativeInt = z.number().int().nonnegative();
const zPositiveInt = z.number().int().positive();

export const ipcNoArgs = z.tuple([]);

export const ipcClearStorageCategoryArgs = z.tuple([
	z.enum(["tmp", "thumbnails", "appicons", "favicons", "other"]),
]);

export const ipcRevealStorageCategoryArgs = z.tuple([
	z.string().min(1).max(100),
]);

export const ipcIdArgs = z.tuple([zLimitedString(256)]);

export const ipcSetPopupHeightArgs = z.tuple([zPositiveInt.max(4000)]);

export const ipcCopyImageArgs = z.tuple([zLimitedString(10_000)]);

export const ipcOpenExternalArgs = z.tuple([zLimitedString(2000)]);

export const ipcPickDirectoryArgs = ipcNoArgs;

export const ipcCaptureTriggerArgs = z.union([
	ipcNoArgs,
	z.tuple([
		z
			.object({
				intent: z.enum(["default", "project_progress"]).optional(),
				includeSenderWindow: z.boolean().optional(),
			})
			.strict(),
	]),
]);

export const ipcGetEventsArgs = z.tuple([
	z
		.object({
			limit: zPositiveInt.max(5000).optional(),
			offset: zNonNegativeInt.max(10_000_000).optional(),
			category: zLimitedString(200).optional(),
			project: zLimitedString(200).optional(),
			projectProgress: z.boolean().optional(),
			trackedAddiction: zLimitedString(200).optional(),
			hasTrackedAddiction: z.boolean().optional(),
			appBundleId: zLimitedString(500).optional(),
			urlHost: zLimitedString(500).optional(),
			startDate: z.number().int().optional(),
			endDate: z.number().int().optional(),
			search: zLimitedString(2000).optional(),
			dismissed: z.boolean().optional(),
		})
		.strict(),
]);

export const ipcGetTimelineFacetsArgs = z.tuple([
	z
		.object({
			startDate: z.number().int().optional(),
			endDate: z.number().int().optional(),
		})
		.strict(),
]);

export const ipcDismissEventsArgs = z.tuple([
	z.array(zLimitedString(256)).max(5000),
]);

export const ipcRelabelEventsArgs = z.tuple([
	z.array(zLimitedString(256)).max(5000),
	zLimitedString(200),
]);

export const ipcConfirmAddictionArgs = z.tuple([
	z.array(zLimitedString(256)).max(5000),
]);

export const ipcRejectAddictionArgs = z.tuple([
	z.array(zLimitedString(256)).max(5000),
]);

export const ipcSetEventCaptionArgs = z.tuple([
	zLimitedString(256),
	zLimitedString(5000),
]);

export const ipcSetEventProjectArgs = z.tuple([
	zLimitedString(256),
	zLimitedString(200).nullable(),
]);

export const ipcSubmitProjectProgressCaptureArgs = z.tuple([
	z
		.object({
			id: zLimitedString(256),
			caption: z.string().max(5000),
			project: zLimitedString(200).nullable(),
		})
		.strict(),
]);

export const ipcGetMemoriesArgs = z.tuple([
	z.enum(["addiction", "project", "preference"]).optional(),
]);

export const ipcInsertMemoryArgs = z.tuple([
	z
		.object({
			id: zLimitedString(256),
			type: z.enum(["addiction", "project", "preference"]),
			content: zLimitedString(20_000),
			description: z.string().max(20_000).nullable().optional(),
			createdAt: zNonNegativeInt,
			updatedAt: zNonNegativeInt,
		})
		.strict(),
]);

export const ipcUpdateMemoryArgs = z.tuple([
	zLimitedString(256),
	z
		.object({
			content: zLimitedString(20_000),
			description: z.string().max(20_000).nullable().optional(),
		})
		.strict(),
]);

export const ipcGetStatsArgs = z.tuple([z.number().int(), z.number().int()]);

export const ipcGetStatsBatchArgs = z.tuple([
	z.array(zLimitedString(200)).max(500),
]);

export const ipcGetStoriesArgs = z.tuple([zNonEmptyString.max(50).optional()]);

export const ipcInsertStoryArgs = z.tuple([
	z
		.object({
			id: zLimitedString(256),
			periodType: zNonEmptyString.max(50),
			periodStart: z.number().int(),
			periodEnd: z.number().int(),
			content: zLimitedString(200_000),
			createdAt: zNonNegativeInt,
		})
		.strict(),
]);

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
	.strict();

const zAutomationRules = z
	.object({
		apps: z.record(zLimitedString(500), zAutomationRule).default({}),
		hosts: z.record(zLimitedString(500), zAutomationRule).default({}),
	})
	.strict();

const zOnboardingState = z
	.object({
		version: zNonNegativeInt,
		completedAt: z.number().int().nullable(),
	})
	.strict();

const zShortcutAccelerator = zLimitedString(200).nullable();

const zShortcutSettings = z
	.object({
		captureNow: zShortcutAccelerator,
		captureProjectProgress: zShortcutAccelerator,
	})
	.strict();

export const ipcSetSettingsArgs = z.tuple([
	z
		.object({
			apiKey: z.string().min(1).max(5000).nullable(),
			captureInterval: zPositiveInt.max(1440),
			retentionDays: zPositiveInt.max(3650),
			excludedApps: z.array(zLimitedString(500)).max(5000),
			launchAtLogin: z.boolean(),
			automationRules: zAutomationRules,
			onboarding: zOnboardingState,
			shortcuts: zShortcutSettings,
			llmEnabled: z.boolean(),
			allowVisionUploads: z.boolean(),
			localLlmEnabled: z.boolean(),
			localLlmBaseUrl: zLimitedString(2000),
			localLlmModel: zLimitedString(500),
		})
		.strict(),
]);

export const ipcStartSchedulerArgs = z.tuple([
	zPositiveInt.max(1440).optional(),
]);

export const ipcSetShortcutsSuspendedArgs = z.tuple([z.boolean()]);

export const ipcLlmClassifyArgs = z.tuple([zNonEmptyString.max(15_000_000)]);

export const ipcOcrRecognizeArgs = z.tuple([zNonEmptyString.max(15_000_000)]);

export const ipcLlmGenerateStoryArgs = z.tuple([
	z
		.array(
			z
				.object({
					caption: zLimitedString(5000),
					category: zLimitedString(200),
					timestamp: z.number().int(),
					project: zLimitedString(200).nullable().optional(),
					projectProgress: z.boolean().optional(),
				})
				.strict(),
		)
		.max(5000),
	z.enum(["daily", "weekly"]),
]);

export const ipcProjectJournalListReposArgs = z.tuple([zLimitedString(200)]);

export const ipcProjectJournalAttachRepoArgs = z.tuple([
	zLimitedString(200),
	zLimitedString(10_000),
]);

export const ipcProjectJournalDetachRepoArgs = z.tuple([zLimitedString(256)]);

export const ipcProjectJournalGetActivityArgs = z.tuple([
	z
		.object({
			projectName: zLimitedString(200),
			startAt: z.number().int().nonnegative(),
			endAt: z.number().int().nonnegative(),
			limitPerRepo: zPositiveInt.max(5000).optional(),
		})
		.strict(),
]);

export const ipcProjectJournalGenerateSummaryArgs = z.tuple([
	z
		.object({
			projectName: zLimitedString(200),
			startAt: z.number().int().nonnegative(),
			endAt: z.number().int().nonnegative(),
		})
		.strict(),
]);
