export type EventStatus = "pending" | "processing" | "completed" | "failed";

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
	status: EventStatus;
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

export type LatestEventByDisplayId = Pick<
	Event,
	| "id"
	| "timestamp"
	| "endTimestamp"
	| "displayId"
	| "stableHash"
	| "detailHash"
	| "originalPath"
	| "mergedCount"
	| "contextKey"
>;

export type MemoryType = "addiction" | "project" | "preference";

export interface Memory {
	id: string;
	type: MemoryType;
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

export type PermissionStatus = "granted" | "denied" | "not-determined";

export interface CaptureResult {
	id: string;
	timestamp: number;
	displayId: string;
	thumbnailPath: string;
	originalPath: string;
	stableHash: string;
	detailHash: string;
	width: number;
	height: number;
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

export interface QueueItem {
	id: string;
	eventId: string;
	attempts: number;
	createdAt: number;
	nextAttemptAt: number;
}

export interface GetEventsOptions {
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

export interface GetTimelineFacetsOptions {
	startDate?: number;
	endDate?: number;
}

export interface TimelineFacets {
	projects: string[];
	websites: WebsiteEntry[];
	apps: RecordedApp[];
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

export interface CategoryStats {
	category: string;
	count: number;
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

export interface StoryInput {
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

export interface EventSummary {
	caption: string;
	category: string;
	timestamp: number;
	project?: string | null;
	projectProgress?: boolean;
}

export type PeriodType = "daily" | "weekly";

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

export interface ClassificationTrackedAddiction {
	detected: boolean;
	name: string | null;
}

export interface ClassificationProjectProgress {
	shown: boolean;
	confidence: number;
}

export interface ClassificationResult {
	category: "Study" | "Work" | "Leisure" | "Chores" | "Social" | "Unknown";
	subcategories: string[];
	project: string | null;
	project_progress: ClassificationProjectProgress;
	tags: string[];
	confidence: number;
	caption: string;
	tracked_addiction: ClassificationTrackedAddiction;
	addiction_candidate: string | null;
	addiction_confidence: number | null;
	addiction_prompt: string | null;
}

export interface Fingerprint {
	stableHash: string;
	detailHash: string;
}

export interface FingerprintComparison {
	isSimilar: boolean;
	stableDistance: number | null;
	detailDistance: number | null;
}

export interface AutomationStatus {
	systemEvents: PermissionStatus;
	browsers: PermissionStatus;
	apps: PermissionStatus;
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
	screenCapture: PermissionStatus;
	accessibility: PermissionStatus;
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
