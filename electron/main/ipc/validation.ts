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

export const ipcOpenNativeArgs = z.tuple([zLimitedString(10_000)]);

export const ipcPreviewEventArgs = z.tuple([z.any()]);

export const ipcOpenSettingsTabArgs = z.tuple([
	z.enum(["capture", "ai", "automation", "data", "social", "system"]),
]);

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

const zGetEventsOptions = z
	.object({
		limit: zPositiveInt.max(5000).optional(),
		offset: zNonNegativeInt.max(10_000_000).optional(),
		category: zLimitedString(200).optional(),
		project: zLimitedString(200).optional(),
		projectProgress: z.boolean().optional(),
		trackedAddiction: zLimitedString(200).optional(),
		hasTrackedAddiction: z.boolean().optional(),
		needsAddictionReview: z.boolean().optional(),
		appBundleId: zLimitedString(500).optional(),
		urlHost: zLimitedString(500).optional(),
		startDate: z.number().int().optional(),
		endDate: z.number().int().optional(),
		search: zLimitedString(2000).optional(),
		dismissed: z.boolean().optional(),
	})
	.strict();

export const ipcGetEventsArgs = z.tuple([zGetEventsOptions]);

export const ipcGetUnifiedEventsArgs = z.tuple([
	zGetEventsOptions.extend({
		includeRemote: z.boolean().optional(),
	}),
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

export const ipcIdsArgs = z.tuple([z.array(zLimitedString(256)).max(5000)]);

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

export const ipcEodOpenFlowArgs = z.union([
	ipcNoArgs,
	z.tuple([
		z
			.object({
				dayStart: z.number().int().optional(),
			})
			.strict(),
	]),
]);

export const ipcEodGetEntryByDayStartArgs = z.tuple([z.number().int()]);

const zEodAttachment = z.union([
	z
		.object({
			kind: z.literal("event"),
			eventId: zLimitedString(256),
		})
		.strict(),
	z
		.object({
			kind: z.literal("image"),
			path: zLimitedString(10_000),
		})
		.strict(),
]);

const zEodSectionV1 = z
	.object({
		id: zLimitedString(256),
		title: zLimitedString(500),
		body: z.string().max(200_000),
		attachments: z.array(zEodAttachment).max(100),
	})
	.strict();

const zEodContentV1 = z
	.object({
		version: z.literal(1),
		sections: z.array(zEodSectionV1).max(100),
		summaryEventCount: z.number().int().nonnegative().optional(),
	})
	.strict();

const zEodBlock = z.union([
	z
		.object({
			kind: z.literal("text"),
			id: zLimitedString(256),
			content: z.string().max(200_000),
		})
		.strict(),
	z
		.object({
			kind: z.literal("event"),
			id: zLimitedString(256),
			eventId: zLimitedString(256),
		})
		.strict(),
]);

const zEodSectionV2 = z
	.object({
		id: zLimitedString(256),
		title: zLimitedString(500),
		blocks: z.array(zEodBlock).max(500),
	})
	.strict();

const zEodContentV2 = z
	.object({
		version: z.literal(2),
		sections: z.array(zEodSectionV2).max(100),
		summaryEventCount: z.number().int().nonnegative().optional(),
	})
	.strict();

const zEodContent = z.discriminatedUnion("version", [
	zEodContentV1,
	zEodContentV2,
]);

export const ipcEodUpsertEntryArgs = z.tuple([
	z
		.object({
			id: zLimitedString(256),
			dayStart: z.number().int(),
			dayEnd: z.number().int(),
			schemaVersion: zPositiveInt.max(1000),
			content: zEodContent,
			createdAt: zNonNegativeInt,
			updatedAt: zNonNegativeInt,
			submittedAt: z.number().int().nullable(),
		})
		.strict(),
]);

export const ipcEodListEntriesArgs = ipcNoArgs;

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
		lastStep: zLimitedString(50).nullable(),
	})
	.strict();

const zShortcutAccelerator = zLimitedString(200).nullable();

const zShortcutSettings = z
	.object({
		captureNow: zShortcutAccelerator,
		captureProjectProgress: zShortcutAccelerator,
		endOfDay: zShortcutAccelerator,
		smartReminder: zShortcutAccelerator,
	})
	.strict();

const zSharingSettings = z
	.object({
		includeAppName: z.boolean(),
		includeWindowTitle: z.boolean(),
		includeContentInfo: z.boolean(),
	})
	.strict();

const zSocialSharingSettings = z
	.object({
		dayWrapped: z
			.object({
				enabled: z.boolean(),
				includeApps: z.boolean(),
				includeAddiction: z.boolean(),
			})
			.strict(),
		ui: z
			.object({
				hideDayWrappedSharingDisabledWarning: z.boolean(),
			})
			.strict(),
	})
	.strict();

const zAvatarSettings = z
	.object({
		pattern: z.literal("ascii"),
		backgroundColor: z.string().max(100),
		foregroundColor: z.string().max(100),
		asciiChar: z
			.string()
			.trim()
			.min(1)
			.max(1)
			.regex(/^[\x21-\x7E]$/)
			.default("@"),
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
			sharing: zSharingSettings,
			social: zSocialSharingSettings,
			avatar: zAvatarSettings,
			llmEnabled: z.boolean(),
			allowVisionUploads: z.boolean(),
			cloudLlmModel: zLimitedString(500),
			localLlmEnabled: z.boolean(),
			localLlmBaseUrl: zLimitedString(2000),
			localLlmModel: zLimitedString(500),
			autoDetectProgress: z.boolean(),
			showDominantWebsites: z.boolean(),
			customBackendEnabled: z.boolean(),
			customBackendUrl: z.string().max(2000),
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

export const ipcLlmTestConnectionArgs = ipcNoArgs;

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

const zReminderStatus = z.enum([
	"pending",
	"triggered",
	"completed",
	"cancelled",
]);

export const ipcGetRemindersArgs = z.union([
	ipcNoArgs,
	z.tuple([
		z
			.object({
				status: zReminderStatus.optional(),
				limit: zPositiveInt.max(1000).optional(),
				offset: zNonNegativeInt.max(100000).optional(),
				includeNotes: z.boolean().optional(),
			})
			.strict(),
	]),
]);

export const ipcCreateReminderArgs = z.tuple([
	z
		.object({
			id: zLimitedString(256),
			title: zLimitedString(1000),
			body: z.string().max(50000).nullable().optional(),
			sourceText: z.string().max(50000).nullable().optional(),
			remindAt: z.number().int().nullable().optional(),
			thumbnailPath: zLimitedString(10000).nullable().optional(),
			originalPath: zLimitedString(10000).nullable().optional(),
			appBundleId: zLimitedString(500).nullable().optional(),
			windowTitle: zLimitedString(2000).nullable().optional(),
			urlHost: zLimitedString(500).nullable().optional(),
			contentKind: zLimitedString(200).nullable().optional(),
			contextJson: z.string().max(100000).nullable().optional(),
		})
		.strict(),
]);

export const ipcUpdateReminderArgs = z.tuple([
	zLimitedString(256),
	z
		.object({
			title: zLimitedString(1000).optional(),
			body: z.string().max(50000).nullable().optional(),
			remindAt: z.number().int().nullable().optional(),
			status: zReminderStatus.optional(),
		})
		.strict(),
]);
