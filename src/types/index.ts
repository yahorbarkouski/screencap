export interface ProjectProgressPreview {
	imageBase64: string;
	project: string | null;
}

export interface BackgroundContext {
	provider: string;
	kind: string;
	id: string;
	title: string | null;
	subtitle: string | null;
	imageUrl: string | null;
	actionUrl: string | null;
}

export interface Event {
	id: string;
	timestamp: number;
	endTimestamp: number | null;
	displayId: string | null;
	category: string | null;
	subcategories: string | null;
	project: string | null;
	projectProgress: number;
	projectProgressConfidence: number | null;
	projectProgressEvidence: string | null;
	tags: string | null;
	confidence: number | null;
	caption: string | null;
	trackedAddiction: string | null;
	addictionCandidate: string | null;
	addictionConfidence: number | null;
	addictionPrompt: string | null;
	thumbnailPath: string | null;
	originalPath: string | null;
	stableHash: string | null;
	detailHash: string | null;
	mergedCount: number | null;
	dismissed: number;
	userLabel: string | null;
	status: "pending" | "processing" | "completed" | "failed";
	appBundleId: string | null;
	appName: string | null;
	appIconPath: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	urlCanonical: string | null;
	faviconPath: string | null;
	screenshotCount: number | null;
	contentKind: string | null;
	contentId: string | null;
	contentTitle: string | null;
	isFullscreen: number;
	contextProvider: string | null;
	contextConfidence: number | null;
	contextKey: string | null;
	contextJson: string | null;
}

export function parseBackgroundFromEvent(event: Event): BackgroundContext[] {
	if (!event.contextJson) return [];
	try {
		const parsed = JSON.parse(event.contextJson);
		if (Array.isArray(parsed?.background)) {
			return parsed.background;
		}
		return [];
	} catch {
		return [];
	}
}

export interface EventScreenshot {
	id: string;
	eventId: string;
	displayId: string;
	isPrimary: boolean;
	thumbnailPath: string;
	originalPath: string;
	stableHash: string | null;
	detailHash: string | null;
	width: number;
	height: number;
	timestamp: number;
}

export interface Memory {
	id: string;
	type: "addiction" | "project" | "preference";
	content: string;
	description?: string | null;
	createdAt: number;
	updatedAt: number;
}

export type AutomationCapturePolicy = "allow" | "skip";
export type AutomationLlmPolicy = "allow" | "skip";
export type AutomationProjectMode = "auto" | "skip" | "force";
export type AutomationCategory =
	| "Study"
	| "Work"
	| "Leisure"
	| "Chores"
	| "Social"
	| "Unknown";

export interface AutomationRule {
	capture?: AutomationCapturePolicy;
	llm?: AutomationLlmPolicy;
	category?: AutomationCategory;
	tags?: string[];
	projectMode?: AutomationProjectMode;
	project?: string;
}

export interface AutomationRules {
	apps: Record<string, AutomationRule>;
	hosts: Record<string, AutomationRule>;
}

export interface OnboardingState {
	version: number;
	completedAt: number | null;
}

export interface ShortcutSettings {
	captureNow: string | null;
	captureProjectProgress: string | null;
	endOfDay: string | null;
}

export interface Settings {
	apiKey: string | null;
	captureInterval: number;
	retentionDays: number;
	excludedApps: string[];
	launchAtLogin: boolean;
	automationRules: AutomationRules;
	onboarding: OnboardingState;
	shortcuts: ShortcutSettings;
	llmEnabled: boolean;
	allowVisionUploads: boolean;
	cloudLlmModel: string;
	localLlmEnabled: boolean;
	localLlmBaseUrl: string;
	localLlmModel: string;
}

export interface ProjectRepo {
	id: string;
	projectKey: string;
	projectName: string;
	repoRoot: string;
	createdAt: number;
}

export interface GitCommit {
	projectRepoId: string;
	repoRoot: string;
	sha: string;
	timestamp: number;
	subject: string;
	parents: string[];
	insertions: number;
	deletions: number;
	files: string[];
}

export interface Story {
	id: string;
	periodType: string;
	periodStart: number;
	periodEnd: number;
	content: string;
	createdAt: number;
}

export type EodAttachment =
	| {
			kind: "event";
			eventId: string;
	  }
	| {
			kind: "image";
			path: string;
	  };

export interface EodSection {
	id: string;
	title: string;
	body: string;
	attachments: EodAttachment[];
}

export interface EodContentV1 {
	version: 1;
	sections: EodSection[];
	summaryEventCount?: number;
}

export type EodContent = EodContentV1;

export interface EodEntry {
	id: string;
	dayStart: number;
	dayEnd: number;
	schemaVersion: number;
	content: EodContent;
	createdAt: number;
	updatedAt: number;
	submittedAt: number | null;
}

export interface EodEntryInput {
	id: string;
	dayStart: number;
	dayEnd: number;
	schemaVersion: number;
	content: EodContent;
	createdAt: number;
	updatedAt: number;
	submittedAt: number | null;
}

export interface EventFilters {
	category?: string;
	project?: string;
	projectProgress?: boolean;
	appBundleId?: string;
	urlHost?: string;
	startDate?: number;
	endDate?: number;
	search?: string;
	dismissed?: boolean;
}

export interface WebsiteEntry {
	host: string;
	faviconPath: string | null;
}

export interface RecordedApp {
	bundleId: string;
	name: string | null;
	appIconPath: string | null;
}

export type CaptureIntent = "default" | "project_progress";

export interface CaptureTriggerOptions {
	intent?: CaptureIntent;
	includeSenderWindow?: boolean;
}

export interface CaptureTriggerResult {
	merged: boolean;
	eventId: string | null;
}

export type View =
	| "timeline"
	| "progress"
	| "story"
	| "projects"
	| "addictions"
	| "settings";

export type SettingsTab = "capture" | "ai" | "automation" | "data" | "system";

export interface AutomationStatus {
	systemEvents: "granted" | "denied" | "not-determined";
	browsers: "granted" | "denied" | "not-determined";
	apps: "granted" | "denied" | "not-determined";
}

export interface ContextTestResult {
	success: boolean;
	appName: string | null;
	appBundleId: string | null;
	windowTitle: string | null;
	isFullscreen: boolean;
	urlHost: string | null;
	contentKind: string | null;
	contentId: string | null;
	contentTitle: string | null;
	contextKey: string | null;
	provider: string | null;
	confidence: number | null;
	error: string | null;
}

export interface ContextStatus {
	screenCapture: "granted" | "denied" | "not-determined";
	accessibility: "granted" | "denied" | "not-determined";
	automation: AutomationStatus;
}

export interface AppInfo {
	name: string;
	version: string;
	isPackaged: boolean;
	buildDate: string | null;
	gitSha: string | null;
	releaseChannel: string | null;
	electron: string;
	chrome: string;
	node: string;
	platform: string;
	arch: string;
	osVersion: string;
}

export interface LLMTestResult {
	success: boolean;
	error?: string;
}

export interface OcrLine {
	text: string;
	confidence: number;
}

export interface OcrResult {
	text: string;
	lines: OcrLine[];
	confidence: number;
	durationMs: number;
}

export type UpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "downloaded"
	| "not_available"
	| "error";

export interface UpdateProgress {
	percent: number;
	transferred: number;
	total: number;
	bytesPerSecond: number;
}

export interface UpdateError {
	message: string;
	code?: string;
}

export interface UpdateState {
	status: UpdateStatus;
	currentVersion: string;
	availableVersion?: string;
	releaseNotes?: string;
	publishedAt?: string;
	progress?: UpdateProgress;
	error?: UpdateError;
	lastCheckedAt?: number;
}

export type ClearableStorageCategory =
	| "tmp"
	| "thumbnails"
	| "appicons"
	| "favicons"
	| "other";

export interface StorageUsageEntry {
	key: string;
	label: string;
	path: string;
	bytes: number;
	clearable: boolean;
}

export interface StorageUsageBreakdown {
	totalBytes: number;
	entries: StorageUsageEntry[];
	computedAt: number;
}

export interface AddictionStatsItem {
	name: string;
	lastIncidentAt: number | null;
	weekCount: number;
	prevWeekCount: number;
	coverOriginalPath: string | null;
	coverThumbnailPath: string | null;
}

export interface ProjectStatsItem {
	name: string;
	eventCount: number;
	lastEventAt: number | null;
	coverOriginalPath: string | null;
	coverThumbnailPath: string | null;
	coverProjectProgress: number;
}

export interface ProjectShare {
	projectName: string;
	publicId: string;
	writeKey: string;
	shareUrl: string;
	createdAt: number;
	updatedAt: number;
	lastPublishedAt: number | null;
}

export interface CreateShareResult {
	publicId: string;
	writeKey: string;
	shareUrl: string;
}

export interface SocialIdentity {
	userId: string;
	deviceId: string;
	username: string;
}

export interface Friend {
	userId: string;
	username: string;
	deviceId: string | null;
	dhPubKey: string | null;
	createdAt: number;
}

export interface FriendRequest {
	id: string;
	fromUserId: string;
	fromUsername: string;
	toUserId: string;
	toUsername: string;
	status: "pending" | "accepted" | "rejected";
	createdAt: number;
	respondedAt: number | null;
}

export interface ChatThread {
	id: string;
	kind: "dm" | "project";
	roomId: string | null;
	title: string;
	createdAt: number;
}

export interface ChatMessage {
	id: string;
	threadId: string;
	authorUserId: string;
	timestampMs: number;
	text: string;
}

export interface Room {
	id: string;
	kind: "project";
	name: string;
	visibility: "private" | "public";
	role: "owner" | "member";
	createdBy: string;
	createdAt: number;
}

export interface RoomInvite {
	id: string;
	roomId: string;
	roomName: string;
	fromUserId: string;
	fromUsername: string;
	createdAt: number;
}

export interface RoomTimelineEvent {
	id: string;
	roomId: string;
	authorUserId: string;
	timestampMs: number;
	caption: string | null;
	imageRef: string | null;
}

export interface SharedProject {
	roomId: string;
	projectName: string;
	ownerUserId: string;
	ownerUsername: string;
	isOwner: boolean;
	joinedAt: number;
	lastSyncedAt: number | null;
}

export interface SharedEvent {
	id: string;
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	timestampMs: number;
	caption: string | null;
	imageCachePath: string | null;
}

export interface AcceptRoomInviteParams {
	roomId: string;
	roomName: string;
	ownerUserId: string;
	ownerUsername: string;
}

declare global {
	interface Window {
		api: {
			app: {
				quit: () => Promise<void>;
				copyImage: (path: string) => Promise<boolean>;
				getInfo: () => Promise<AppInfo>;
				openExternal: (url: string) => Promise<void>;
				revealInFinder: () => Promise<void>;
				pickDirectory: () => Promise<string | null>;
			};
			update: {
				getState: () => Promise<UpdateState>;
				check: () => Promise<void>;
				download: () => Promise<void>;
				restartAndInstall: () => Promise<void>;
			};
			window: {
				minimize: () => Promise<void>;
				maximize: () => Promise<void>;
				show: () => Promise<void>;
				close: () => Promise<void>;
			};
			popup: {
				setHeight: (height: number) => Promise<void>;
				startProjectProgressCapture: () => Promise<void>;
			};
			permissions: {
				checkScreenCapture: () => Promise<
					"granted" | "denied" | "not-determined"
				>;
				hasScreenCapture: () => Promise<boolean>;
				openSettings: () => Promise<void>;
				getAccessibility: () => Promise<
					"granted" | "denied" | "not-determined"
				>;
				requestAccessibility: () => Promise<boolean>;
				openAccessibilitySettings: () => Promise<void>;
				getAutomation: () => Promise<AutomationStatus>;
				openAutomationSettings: () => Promise<void>;
			};
			context: {
				test: () => Promise<ContextTestResult>;
				getStatus: () => Promise<ContextStatus>;
			};
			capture: {
				allDisplays: () => Promise<unknown[]>;
				primary: () => Promise<string | null>;
				trigger: (
					options?: CaptureTriggerOptions,
				) => Promise<CaptureTriggerResult>;
			};
			scheduler: {
				start: (intervalMinutes?: number) => Promise<void>;
				stop: () => Promise<void>;
				isRunning: () => Promise<boolean>;
			};
			storage: {
				getEvents: (options: {
					limit?: number;
					offset?: number;
					category?: string;
					project?: string;
					projectProgress?: boolean;
					trackedAddiction?: string;
					hasTrackedAddiction?: boolean;
					appBundleId?: string;
					urlHost?: string;
					startDate?: number;
					endDate?: number;
					search?: string;
					dismissed?: boolean;
				}) => Promise<Event[]>;
				getEvent: (id: string) => Promise<Event | null>;
				getEventScreenshots: (eventId: string) => Promise<EventScreenshot[]>;
				getDiskUsage: () => Promise<StorageUsageBreakdown>;
				clearStorageCategory: (
					category: ClearableStorageCategory,
				) => Promise<{ clearedBytes: number }>;
				revealStorageCategory: (category: string) => Promise<void>;
				dismissEvents: (ids: string[]) => Promise<void>;
				relabelEvents: (ids: string[], label: string) => Promise<void>;
				confirmAddiction: (ids: string[]) => Promise<void>;
				rejectAddiction: (ids: string[]) => Promise<void>;
				setEventCaption: (id: string, caption: string) => Promise<void>;
				setEventProject: (id: string, project: string | null) => Promise<void>;
				submitProjectProgressCapture: (input: {
					id: string;
					caption: string;
					project: string | null;
				}) => Promise<void>;
				unmarkProjectProgress: (id: string) => Promise<void>;
				deleteEvent: (id: string) => Promise<void>;
				getMemories: (type?: string) => Promise<Memory[]>;
				insertMemory: (memory: Memory) => Promise<void>;
				updateMemory: (
					id: string,
					updates: { content: string; description?: string | null },
				) => Promise<void>;
				deleteMemory: (id: string) => Promise<void>;
				getCategories: () => Promise<string[]>;
				getProjects: () => Promise<string[]>;
				getApps: () => Promise<RecordedApp[]>;
				getWebsites: () => Promise<WebsiteEntry[]>;
				getTimelineFacets: (options: {
					startDate?: number;
					endDate?: number;
				}) => Promise<{
					projects: string[];
					websites: WebsiteEntry[];
					apps: RecordedApp[];
				}>;
				getStats: (
					startDate: number,
					endDate: number,
				) => Promise<{ category: string; count: number }[]>;
				getStories: (periodType?: string) => Promise<Story[]>;
				insertStory: (story: {
					id: string;
					periodType: string;
					periodStart: number;
					periodEnd: number;
					content: string;
					createdAt: number;
				}) => Promise<void>;
				getAddictionStatsBatch: (
					names: string[],
				) => Promise<Record<string, AddictionStatsItem>>;
				getProjectStatsBatch: (
					names: string[],
				) => Promise<Record<string, ProjectStatsItem>>;
			};
			settings: {
				get: () => Promise<Settings>;
				set: (settings: Settings) => Promise<void>;
			};
			shortcuts: {
				setSuspended: (suspended: boolean) => Promise<void>;
			};
			projectJournal: {
				listRepos: (projectName: string) => Promise<ProjectRepo[]>;
				attachRepo: (projectName: string, path: string) => Promise<ProjectRepo>;
				detachRepo: (repoId: string) => Promise<void>;
				getActivity: (options: {
					projectName: string;
					startAt: number;
					endAt: number;
					limitPerRepo?: number;
				}) => Promise<{
					repos: ProjectRepo[];
					commits: GitCommit[];
				}>;
			};
			llm: {
				classify: (imageBase64: string) => Promise<unknown>;
				generateStory: (
					events: {
						caption: string;
						category: string;
						timestamp: number;
						project?: string | null;
						projectProgress?: boolean;
					}[],
					periodType: "daily" | "weekly",
				) => Promise<string>;
				testConnection: () => Promise<LLMTestResult>;
				testLocalConnection: () => Promise<LLMTestResult>;
			};
			ocr: {
				recognize: (imageBase64: string) => Promise<OcrResult>;
			};
			eod: {
				openFlow: (options?: { dayStart?: number }) => Promise<void>;
				getEntryByDayStart: (dayStart: number) => Promise<EodEntry | null>;
				upsertEntry: (entry: EodEntryInput) => Promise<void>;
				listEntries: () => Promise<EodEntry[]>;
			};
			publishing: {
				createShare: (projectName: string) => Promise<CreateShareResult>;
				getShare: (projectName: string) => Promise<ProjectShare | null>;
				disableShare: (projectName: string) => Promise<void>;
				syncShare: (projectName: string) => Promise<number>;
			};
			social: {
				getIdentity: () => Promise<SocialIdentity | null>;
				registerUsername: (username: string) => Promise<SocialIdentity>;
				sendFriendRequest: (
					toUsername: string,
				) => Promise<{ requestId: string; status: "pending" | "accepted" }>;
				listFriends: () => Promise<Friend[]>;
				listFriendRequests: () => Promise<FriendRequest[]>;
				acceptFriendRequest: (requestId: string) => Promise<void>;
				rejectFriendRequest: (requestId: string) => Promise<void>;
			};
			chat: {
				listThreads: () => Promise<ChatThread[]>;
				openDmThread: (friendUserId: string) => Promise<string>;
				openProjectThread: (roomId: string) => Promise<string>;
				fetchMessages: (
					threadId: string,
					since?: number,
				) => Promise<ChatMessage[]>;
				sendMessage: (threadId: string, text: string) => Promise<void>;
			};
			rooms: {
				ensureProjectRoom: (projectName: string) => Promise<string>;
				inviteFriendToProjectRoom: (
					projectName: string,
					friendUserId: string,
				) => Promise<void>;
				listRooms: () => Promise<Room[]>;
				listInvites: () => Promise<RoomInvite[]>;
				acceptProjectInvite: (params: AcceptRoomInviteParams) => Promise<void>;
				fetchRoomEvents: (
					roomId: string,
					since?: number,
				) => Promise<RoomTimelineEvent[]>;
			};
			sharedProjects: {
				list: () => Promise<SharedProject[]>;
				getEvents: (params: {
					roomId: string;
					startDate?: number;
					endDate?: number;
					limit?: number;
				}) => Promise<SharedEvent[]>;
				sync: (roomId: string) => Promise<{ count: number }>;
				syncAll: () => Promise<void>;
			};
			on: (
				channel:
					| "permission:required"
					| "event:created"
					| "event:updated"
					| "events:changed"
					| "projects:normalized"
					| "update:state"
					| "shortcut:capture-now"
					| "shortcut:capture-project-progress-preview"
					| "shortcut:capture-project-progress"
					| "shortcut:end-of-day",
				callback: (...args: unknown[]) => void,
			) => () => void;
		};
	}
}
