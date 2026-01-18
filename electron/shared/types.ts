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

export function parseBackgroundFromEvent(event: {
	contextJson: string | null;
}): BackgroundContext[] {
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
	potentialProgress: number;
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
	sharedToFriends: number;
	authorUserId?: string;
	authorUsername?: string;
	isRemote?: boolean;
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
	lastStep: string | null;
}

export interface ShortcutSettings {
	captureNow: string | null;
	captureProjectProgress: string | null;
	endOfDay: string | null;
	smartReminder: string | null;
}

export interface SharingSettings {
	includeAppName: boolean;
	includeWindowTitle: boolean;
	includeContentInfo: boolean;
}

export interface DayWrappedSharingSettings {
	enabled: boolean;
	includeApps: boolean;
	includeAddiction: boolean;
}

export interface SocialUiSettings {
	hideDayWrappedSharingDisabledWarning: boolean;
}

export interface SocialSharingSettings {
	dayWrapped: DayWrappedSharingSettings;
	ui: SocialUiSettings;
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
	sharing: SharingSettings;
	social: SocialSharingSettings;
	avatar: AvatarSettings;
	llmEnabled: boolean;
	allowVisionUploads: boolean;
	cloudLlmModel: string;
	localLlmEnabled: boolean;
	localLlmBaseUrl: string;
	localLlmModel: string;
	autoDetectProgress: boolean;
	showDominantWebsites: boolean;
	customBackendEnabled: boolean;
	customBackendUrl: string;
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
	| "hq"
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

export interface EodSectionV1 {
	id: string;
	title: string;
	body: string;
	attachments: EodAttachment[];
}

export interface EodContentV1 {
	version: 1;
	sections: EodSectionV1[];
	summaryEventCount?: number;
}

export type EodBlock =
	| { kind: "text"; id: string; content: string }
	| { kind: "event"; id: string; eventId: string };

export interface EodSection {
	id: string;
	title: string;
	blocks: EodBlock[];
}

export interface EodContentV2 {
	version: 2;
	sections: EodSection[];
	summaryEventCount?: number;
}

export type EodContent = EodContentV1 | EodContentV2;

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
	potential_progress: boolean;
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

export interface SocialIdentity {
	userId: string;
	deviceId: string;
	username: string;
}

export type AvatarPattern = "ascii";

export interface AvatarSettings {
	pattern: AvatarPattern;
	backgroundColor: string;
	foregroundColor: string;
	asciiChar: string;
}

export interface Friend {
	userId: string;
	username: string;
	deviceId: string | null;
	dhPubKey: string | null;
	avatarSettings: AvatarSettings | null;
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

export interface RoomMember {
	userId: string;
	username: string;
	role: string;
}

export type InviteStatus = "pending" | "member" | "none";

export type SentInviteStatus = "pending" | "accepted" | "declined" | "expired";

export interface SentInvite {
	id: string;
	roomId: string;
	toUserId: string;
	toUsername: string;
	sentAt: number;
	status: SentInviteStatus;
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
	endTimestampMs: number | null;
	project: string | null;
	category: string | null;
	caption: string | null;
	projectProgress: number;
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
	contentKind: string | null;
	contentTitle: string | null;
	thumbnailPath: string | null;
	originalPath: string | null;
	imageRef: string | null;
	url: string | null;
	background: BackgroundContext[];
}

export interface DayWrappedSlot {
	startMs: number;
	count: number;
	category: AutomationCategory;
	addiction: string | null;
	appName: string | null;
}

export interface DayWrappedSnapshot {
	roomId: string;
	authorUserId: string;
	authorUsername: string;
	publishedAtMs: number;
	dayStartMs: number;
	slots: DayWrappedSlot[];
}

export interface AcceptRoomInviteParams {
	roomId: string;
	roomName: string;
	ownerUserId: string;
	ownerUsername: string;
}

export interface LogEntry {
	timestamp: string;
	level: string;
	scope: string;
	message: string;
	data?: unknown;
}

export interface LogsCollectResult {
	logs: string;
	entryCount: number;
	appInfo: AppInfo;
}

export interface RendererLogEntry {
	timestamp: string;
	level: string;
	windowKind: string;
	message: string;
}

export interface CrashSessionLogSummary {
	id: string;
	createdAt: string;
	sizeBytes: number;
}

export type ReminderStatus =
	| "pending"
	| "triggered"
	| "completed"
	| "cancelled";

export interface Reminder {
	id: string;
	title: string;
	body: string | null;
	sourceText: string | null;
	remindAt: number | null;
	status: ReminderStatus;
	createdAt: number;
	updatedAt: number;
	triggeredAt: number | null;
	completedAt: number | null;
	thumbnailPath: string | null;
	originalPath: string | null;
	appBundleId: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	contentKind: string | null;
	contextJson: string | null;
}

export interface ReminderInput {
	id: string;
	title: string;
	body?: string | null;
	sourceText?: string | null;
	remindAt?: number | null;
	thumbnailPath?: string | null;
	originalPath?: string | null;
	appBundleId?: string | null;
	windowTitle?: string | null;
	urlHost?: string | null;
	contentKind?: string | null;
	contextJson?: string | null;
}

export interface ReminderUpdate {
	title?: string;
	body?: string | null;
	remindAt?: number | null;
	status?: ReminderStatus;
}

export interface GetRemindersOptions {
	status?: ReminderStatus;
	limit?: number;
	offset?: number;
	includeNotes?: boolean;
}
