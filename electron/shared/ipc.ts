import type {
	AddictionStatsItem,
	AppInfo,
	AutomationStatus,
	CaptureResult,
	CaptureTriggerOptions,
	CaptureTriggerResult,
	CategoryStats,
	ClassificationResult,
	ClearableStorageCategory,
	ContextStatus,
	ContextTestResult,
	Event,
	EventScreenshot,
	EventSummary,
	GetEventsOptions,
	GetTimelineFacetsOptions,
	GitCommit,
	LLMTestResult,
	Memory,
	OcrResult,
	PeriodType,
	PermissionStatus,
	ProjectRepo,
	ProjectStatsItem,
	RecordedApp,
	RepoWorkSession,
	Settings,
	StorageUsageBreakdown,
	Story,
	StoryInput,
	TimelineFacets,
	UpdateState,
	WebsiteEntry,
} from "./types";

export const IpcChannels = {
	App: {
		Quit: "app:quit",
		CopyImage: "app:copy-image",
		GetInfo: "app:get-info",
		OpenExternal: "app:open-external",
		RevealInFinder: "app:reveal-in-finder",
		PickDirectory: "app:pick-directory",
	},
	Update: {
		GetState: "update:get-state",
		Check: "update:check",
		Download: "update:download",
		RestartAndInstall: "update:restart-and-install",
	},
	Window: {
		Minimize: "window:minimize",
		Maximize: "window:maximize",
		Show: "window:show",
		Close: "window:close",
	},
	Popup: {
		SetHeight: "popup:set-height",
		StartProjectProgressCapture: "popup:start-project-progress-capture",
	},
	Permissions: {
		CheckScreenCapture: "permissions:check-screen-capture",
		HasScreenCapture: "permissions:has-screen-capture",
		OpenSettings: "permissions:open-settings",
		GetAccessibility: "permissions:get-accessibility",
		RequestAccessibility: "permissions:request-accessibility",
		OpenAccessibilitySettings: "permissions:open-accessibility-settings",
		GetAutomation: "permissions:get-automation",
		OpenAutomationSettings: "permissions:open-automation-settings",
	},
	Context: {
		Test: "context:test",
		GetStatus: "context:get-status",
	},
	Capture: {
		AllDisplays: "capture:all-displays",
		Primary: "capture:primary",
		Trigger: "capture:trigger",
	},
	Scheduler: {
		Start: "scheduler:start",
		Stop: "scheduler:stop",
		IsRunning: "scheduler:is-running",
	},
	Storage: {
		GetEvents: "storage:get-events",
		GetEvent: "storage:get-event",
		GetEventScreenshots: "storage:get-event-screenshots",
		GetDiskUsage: "storage:get-disk-usage",
		ClearStorageCategory: "storage:clear-storage-category",
		RevealStorageCategory: "storage:reveal-storage-category",
		DismissEvents: "storage:dismiss-events",
		RelabelEvents: "storage:relabel-events",
		ConfirmAddiction: "storage:confirm-addiction",
		RejectAddiction: "storage:reject-addiction",
		SetEventCaption: "storage:set-event-caption",
		SetEventProject: "storage:set-event-project",
		SubmitProjectProgressCapture: "storage:submit-project-progress-capture",
		UnmarkProjectProgress: "storage:unmark-project-progress",
		DeleteEvent: "storage:delete-event",
		GetMemories: "storage:get-memories",
		InsertMemory: "storage:insert-memory",
		UpdateMemory: "storage:update-memory",
		DeleteMemory: "storage:delete-memory",
		GetCategories: "storage:get-categories",
		GetProjects: "storage:get-projects",
		GetApps: "storage:get-apps",
		GetWebsites: "storage:get-websites",
		GetTimelineFacets: "storage:get-timeline-facets",
		GetStats: "storage:get-stats",
		GetStories: "storage:get-stories",
		InsertStory: "storage:insert-story",
		GetAddictionStatsBatch: "storage:get-addiction-stats-batch",
		GetProjectStatsBatch: "storage:get-project-stats-batch",
	},
	Settings: {
		Get: "settings:get",
		Set: "settings:set",
	},
	Shortcuts: {
		SetSuspended: "shortcuts:set-suspended",
	},
	ProjectJournal: {
		ListRepos: "project-journal:list-repos",
		AttachRepo: "project-journal:attach-repo",
		DetachRepo: "project-journal:detach-repo",
		GetActivity: "project-journal:get-activity",
		GenerateSummary: "project-journal:generate-summary",
	},
	LLM: {
		Classify: "llm:classify",
		GenerateStory: "llm:generate-story",
		TestConnection: "llm:test-connection",
		TestLocalConnection: "llm:test-local-connection",
	},
	Ocr: {
		Recognize: "ocr:recognize",
	},
} as const;

export const IpcEvents = {
	PermissionRequired: "permission:required",
	EventCreated: "event:created",
	EventUpdated: "event:updated",
	EventsChanged: "events:changed",
	ProjectsNormalized: "projects:normalized",
	UpdateState: "update:state",
	ShortcutCaptureNow: "shortcut:capture-now",
	ShortcutCaptureProjectProgress: "shortcut:capture-project-progress",
} as const;

export interface IpcInvokeHandlers {
	[IpcChannels.App.Quit]: () => void;
	[IpcChannels.App.CopyImage]: (path: string) => boolean;
	[IpcChannels.App.GetInfo]: () => AppInfo;
	[IpcChannels.App.OpenExternal]: (url: string) => void;
	[IpcChannels.App.RevealInFinder]: () => void;
	[IpcChannels.App.PickDirectory]: () => Promise<string | null>;

	[IpcChannels.Update.GetState]: () => UpdateState;
	[IpcChannels.Update.Check]: () => void;
	[IpcChannels.Update.Download]: () => void;
	[IpcChannels.Update.RestartAndInstall]: () => void;

	[IpcChannels.Window.Minimize]: () => void;
	[IpcChannels.Window.Maximize]: () => void;
	[IpcChannels.Window.Show]: () => void;
	[IpcChannels.Window.Close]: () => void;

	[IpcChannels.Popup.SetHeight]: (height: number) => void;
	[IpcChannels.Popup.StartProjectProgressCapture]: () => Promise<void>;

	[IpcChannels.Permissions.CheckScreenCapture]: () => PermissionStatus;
	[IpcChannels.Permissions.HasScreenCapture]: () => boolean;
	[IpcChannels.Permissions.OpenSettings]: () => void;
	[IpcChannels.Permissions.GetAccessibility]: () => PermissionStatus;
	[IpcChannels.Permissions.RequestAccessibility]: () => boolean;
	[IpcChannels.Permissions.OpenAccessibilitySettings]: () => void;
	[IpcChannels.Permissions.GetAutomation]: () => AutomationStatus;
	[IpcChannels.Permissions.OpenAutomationSettings]: () => void;

	[IpcChannels.Context.Test]: () => Promise<ContextTestResult>;
	[IpcChannels.Context.GetStatus]: () => ContextStatus;

	[IpcChannels.Capture.AllDisplays]: () => Promise<CaptureResult[]>;
	[IpcChannels.Capture.Primary]: () => Promise<string | null>;
	[IpcChannels.Capture.Trigger]: (
		options?: CaptureTriggerOptions,
	) => Promise<CaptureTriggerResult>;

	[IpcChannels.Scheduler.Start]: (intervalMinutes?: number) => void;
	[IpcChannels.Scheduler.Stop]: () => void;
	[IpcChannels.Scheduler.IsRunning]: () => boolean;

	[IpcChannels.Storage.GetEvents]: (options: GetEventsOptions) => Event[];
	[IpcChannels.Storage.GetEvent]: (id: string) => Event | null;
	[IpcChannels.Storage.GetEventScreenshots]: (
		eventId: string,
	) => EventScreenshot[];
	[IpcChannels.Storage.GetDiskUsage]: () => Promise<StorageUsageBreakdown>;
	[IpcChannels.Storage.ClearStorageCategory]: (
		category: ClearableStorageCategory,
	) => Promise<{ clearedBytes: number }>;
	[IpcChannels.Storage.RevealStorageCategory]: (category: string) => void;
	[IpcChannels.Storage.DismissEvents]: (ids: string[]) => void;
	[IpcChannels.Storage.RelabelEvents]: (ids: string[], label: string) => void;
	[IpcChannels.Storage.ConfirmAddiction]: (ids: string[]) => void;
	[IpcChannels.Storage.RejectAddiction]: (ids: string[]) => void;
	[IpcChannels.Storage.SetEventCaption]: (id: string, caption: string) => void;
	[IpcChannels.Storage.SetEventProject]: (
		id: string,
		project: string | null,
	) => void;
	[IpcChannels.Storage.SubmitProjectProgressCapture]: (input: {
		id: string;
		caption: string;
		project: string | null;
	}) => void;
	[IpcChannels.Storage.UnmarkProjectProgress]: (id: string) => void;
	[IpcChannels.Storage.DeleteEvent]: (id: string) => void;
	[IpcChannels.Storage.GetMemories]: (type?: string) => Memory[];
	[IpcChannels.Storage.InsertMemory]: (memory: Memory) => void;
	[IpcChannels.Storage.UpdateMemory]: (
		id: string,
		updates: { content: string; description?: string | null },
	) => void;
	[IpcChannels.Storage.DeleteMemory]: (id: string) => void;
	[IpcChannels.Storage.GetCategories]: () => string[];
	[IpcChannels.Storage.GetProjects]: () => string[];
	[IpcChannels.Storage.GetApps]: () => RecordedApp[];
	[IpcChannels.Storage.GetWebsites]: () => WebsiteEntry[];
	[IpcChannels.Storage.GetTimelineFacets]: (
		options: GetTimelineFacetsOptions,
	) => TimelineFacets;
	[IpcChannels.Storage.GetStats]: (
		startDate: number,
		endDate: number,
	) => CategoryStats[];
	[IpcChannels.Storage.GetStories]: (periodType?: string) => Story[];
	[IpcChannels.Storage.InsertStory]: (story: StoryInput) => void;
	[IpcChannels.Storage.GetAddictionStatsBatch]: (
		names: string[],
	) => Record<string, AddictionStatsItem>;
	[IpcChannels.Storage.GetProjectStatsBatch]: (
		names: string[],
	) => Record<string, ProjectStatsItem>;

	[IpcChannels.Settings.Get]: () => Settings;
	[IpcChannels.Settings.Set]: (settings: Settings) => void;

	[IpcChannels.Shortcuts.SetSuspended]: (suspended: boolean) => void;

	[IpcChannels.ProjectJournal.ListRepos]: (
		projectName: string,
	) => ProjectRepo[];
	[IpcChannels.ProjectJournal.AttachRepo]: (
		projectName: string,
		path: string,
	) => Promise<ProjectRepo>;
	[IpcChannels.ProjectJournal.DetachRepo]: (repoId: string) => void;
	[IpcChannels.ProjectJournal.GetActivity]: (options: {
		projectName: string;
		startAt: number;
		endAt: number;
		limitPerRepo?: number;
	}) => Promise<{
		repos: ProjectRepo[];
		commits: GitCommit[];
		sessions: RepoWorkSession[];
	}>;
	[IpcChannels.ProjectJournal.GenerateSummary]: (options: {
		projectName: string;
		startAt: number;
		endAt: number;
	}) => Promise<string>;

	[IpcChannels.LLM.Classify]: (
		imageBase64: string,
	) => Promise<ClassificationResult | null>;
	[IpcChannels.LLM.GenerateStory]: (
		events: EventSummary[],
		periodType: PeriodType,
	) => Promise<string>;
	[IpcChannels.LLM.TestConnection]: () => Promise<LLMTestResult>;
	[IpcChannels.LLM.TestLocalConnection]: () => Promise<LLMTestResult>;

	[IpcChannels.Ocr.Recognize]: (imageBase64: string) => Promise<OcrResult>;
}

export interface IpcEventPayloads {
	[IpcEvents.PermissionRequired]: undefined;
	[IpcEvents.EventCreated]: string;
	[IpcEvents.EventUpdated]: string;
	[IpcEvents.EventsChanged]: undefined;
	[IpcEvents.ProjectsNormalized]: { updatedRows: number; groups: number };
	[IpcEvents.UpdateState]: UpdateState;
	[IpcEvents.ShortcutCaptureNow]: undefined;
	[IpcEvents.ShortcutCaptureProjectProgress]: string | null;
}
