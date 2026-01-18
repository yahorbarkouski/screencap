function snakeToCamel(str: string): string {
	return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function transformRow<T>(row: Record<string, unknown>): T {
	const result: Record<string, unknown> = {};
	for (const key in row) {
		result[snakeToCamel(key)] = row[key];
	}
	return result as T;
}

export function transformRows<T>(rows: Record<string, unknown>[]): T[] {
	return rows.map((row) => transformRow<T>(row));
}

export const CAMEL_TO_SNAKE_MAP: Record<string, string> = {
	displayId: "display_id",
	endTimestamp: "end_timestamp",
	trackedAddiction: "tracked_addiction",
	addictionCandidate: "addiction_candidate",
	addictionConfidence: "addiction_confidence",
	addictionPrompt: "addiction_prompt",
	projectProgress: "project_progress",
	projectProgressConfidence: "project_progress_confidence",
	projectProgressEvidence: "project_progress_evidence",
	potentialProgress: "potential_progress",
	thumbnailPath: "thumbnail_path",
	originalPath: "original_path",
	userLabel: "user_label",
	stableHash: "stable_hash",
	detailHash: "detail_hash",
	mergedCount: "merged_count",
	createdAt: "created_at",
	updatedAt: "updated_at",
	periodType: "period_type",
	periodStart: "period_start",
	periodEnd: "period_end",
	eventId: "event_id",
	nextAttemptAt: "next_attempt_at",
	appBundleId: "app_bundle_id",
	appName: "app_name",
	windowTitle: "window_title",
	urlHost: "url_host",
	urlCanonical: "url_canonical",
	contentKind: "content_kind",
	contentId: "content_id",
	contentTitle: "content_title",
	isFullscreen: "is_fullscreen",
	contextProvider: "context_provider",
	contextConfidence: "context_confidence",
	contextKey: "context_key",
	contextJson: "context_json",
	sharedToFriends: "shared_to_friends",
	sourceText: "source_text",
	remindAt: "remind_at",
	triggeredAt: "triggered_at",
	completedAt: "completed_at",
};

export function toSnakeCase(key: string): string {
	return CAMEL_TO_SNAKE_MAP[key] ?? key;
}
