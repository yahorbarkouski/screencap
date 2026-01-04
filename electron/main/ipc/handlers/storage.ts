import { existsSync } from "node:fs";
import { shell } from "electron";
import { IpcChannels } from "../../../shared/ipc";
import type {
	ClearableStorageCategory,
	GetEventsOptions,
	GetTimelineFacetsOptions,
	Memory,
	StoryInput,
} from "../../../shared/types";
import { ensureAppIcon } from "../../features/appIcons/AppIconService";
import { ensureFavicon } from "../../features/favicons/FaviconService";
import { normalizeProjectsInDb } from "../../features/projects";
import { publishEvent } from "../../features/publishing/PublishingService";
import { triggerQueueProcess } from "../../features/queue";
import { publishProgressEventToRoom } from "../../features/sync/RoomSyncService";
import {
	confirmAddiction,
	deleteEvent,
	dismissEvents,
	getAddictionStatsBatch,
	getCategoryStats,
	getDistinctApps,
	getDistinctAppsInRange,
	getDistinctCategories,
	getDistinctProjects,
	getDistinctProjectsInRange,
	getEventById,
	getEvents,
	getProjectStatsBatch,
	rejectAddiction,
	relabelEvents,
	updateAddictionName,
	updateEvent,
} from "../../infra/db/repositories/EventRepository";
import { getEventScreenshots } from "../../infra/db/repositories/EventScreenshotRepository";
import {
	listWebsitesWithFavicons,
	listWebsitesWithFaviconsInRange,
} from "../../infra/db/repositories/FaviconRepository";
import {
	deleteMemory,
	getMemories,
	getMemoryById,
	getMemoryType,
	insertMemory,
	updateMemory,
} from "../../infra/db/repositories/MemoryRepository";
import {
	addToQueue,
	isEventQueued,
} from "../../infra/db/repositories/QueueRepository";
import {
	getStories,
	insertStory,
} from "../../infra/db/repositories/StoryRepository";
import { createLogger } from "../../infra/log";
import {
	clearStorageCategory,
	getStorageCategoryPath,
	getStorageUsageBreakdown,
} from "../../infra/storageUsage";
import {
	broadcastEventsChanged,
	broadcastEventUpdated,
	broadcastProjectsNormalized,
} from "../../infra/windows";
import { secureHandle } from "../secure";
import {
	ipcClearStorageCategoryArgs,
	ipcConfirmAddictionArgs,
	ipcDismissEventsArgs,
	ipcGetEventsArgs,
	ipcGetMemoriesArgs,
	ipcGetStatsArgs,
	ipcGetStatsBatchArgs,
	ipcGetStoriesArgs,
	ipcGetTimelineFacetsArgs,
	ipcIdArgs,
	ipcInsertMemoryArgs,
	ipcInsertStoryArgs,
	ipcNoArgs,
	ipcRejectAddictionArgs,
	ipcRelabelEventsArgs,
	ipcRevealStorageCategoryArgs,
	ipcSetEventCaptionArgs,
	ipcSetEventProjectArgs,
	ipcSubmitProjectProgressCaptureArgs,
	ipcUpdateMemoryArgs,
} from "../validation";

const logger = createLogger({ scope: "StorageIPC" });

export function registerStorageHandlers(): void {
	secureHandle(
		IpcChannels.Storage.GetEvents,
		ipcGetEventsArgs,
		(options: GetEventsOptions) => {
			const result = getEvents(options);
			const missing = new Map<string, string | null>();
			const missingApps = new Set<string>();
			for (const e of result) {
				if (e.urlHost && !e.faviconPath) {
					missing.set(e.urlHost, e.urlCanonical ?? null);
				}
				if (e.appBundleId && !e.appIconPath) {
					missingApps.add(e.appBundleId);
				}
			}
			missing.forEach((urlCanonical, host) => {
				void ensureFavicon(host, urlCanonical);
			});
			missingApps.forEach((bundleId) => {
				void ensureAppIcon(bundleId);
			});
			return result;
		},
	);

	secureHandle(IpcChannels.Storage.GetEvent, ipcIdArgs, (id: string) => {
		return getEventById(id);
	});

	secureHandle(
		IpcChannels.Storage.GetEventScreenshots,
		ipcIdArgs,
		(eventId: string) => {
			return getEventScreenshots(eventId);
		},
	);

	secureHandle(IpcChannels.Storage.GetDiskUsage, ipcNoArgs, async () => {
		const result = await getStorageUsageBreakdown();
		return result;
	});

	secureHandle(
		IpcChannels.Storage.ClearStorageCategory,
		ipcClearStorageCategoryArgs,
		async (category: ClearableStorageCategory) => {
			return await clearStorageCategory(category);
		},
	);

	secureHandle(
		IpcChannels.Storage.RevealStorageCategory,
		ipcRevealStorageCategoryArgs,
		async (category: string) => {
			const path = getStorageCategoryPath(category);
			if (path) {
				await shell.openPath(path);
			}
		},
	);

	secureHandle(
		IpcChannels.Storage.DismissEvents,
		ipcDismissEventsArgs,
		(ids: string[]) => {
			dismissEvents(ids);
			if (ids.length > 0) broadcastEventsChanged();
		},
	);

	secureHandle(
		IpcChannels.Storage.RelabelEvents,
		ipcRelabelEventsArgs,
		(ids: string[], label: string) => {
			relabelEvents(ids, label);
			if (ids.length > 0) broadcastEventsChanged();
		},
	);

	secureHandle(
		IpcChannels.Storage.ConfirmAddiction,
		ipcConfirmAddictionArgs,
		(ids: string[]) => {
			confirmAddiction(ids);
			if (ids.length > 0) broadcastEventsChanged();
		},
	);

	secureHandle(
		IpcChannels.Storage.RejectAddiction,
		ipcRejectAddictionArgs,
		(ids: string[]) => {
			rejectAddiction(ids);
			if (ids.length > 0) broadcastEventsChanged();
		},
	);

	secureHandle(
		IpcChannels.Storage.SetEventCaption,
		ipcSetEventCaptionArgs,
		(id: string, caption: string) => {
			const next = caption.trim();
			if (!next) return;
			updateEvent(id, { caption: next });
			broadcastEventUpdated(id);
		},
	);

	secureHandle(
		IpcChannels.Storage.SetEventProject,
		ipcSetEventProjectArgs,
		(id: string, project: string | null) => {
			const next = project?.trim() || null;
			updateEvent(id, { project: next });
			broadcastEventUpdated(id);
		},
	);

	secureHandle(
		IpcChannels.Storage.SubmitProjectProgressCapture,
		ipcSubmitProjectProgressCaptureArgs,
		(input: { id: string; caption: string; project: string | null }) => {
			const event = getEventById(input.id);
			if (!event) return;

			const caption = input.caption.trim() || null;
			const project = input.project?.trim() || null;

			updateEvent(input.id, { caption, project });
			broadcastEventUpdated(input.id);

			void publishEvent(input.id).catch((error) => {
				logger.warn("Publish to public share failed", {
					eventId: input.id,
					error: String(error),
				});
			});
			void publishProgressEventToRoom(input.id).catch((error) => {
				logger.warn("Publish to room failed", {
					eventId: input.id,
					error: String(error),
				});
			});

			if (event.status !== "pending") return;
			if (!event.originalPath || !existsSync(event.originalPath)) return;

			if (!isEventQueued(input.id)) {
				addToQueue(input.id);
			}
			triggerQueueProcess();
		},
	);

	secureHandle(
		IpcChannels.Storage.UnmarkProjectProgress,
		ipcIdArgs,
		(id: string) => {
			updateEvent(id, { projectProgress: 0 });
			broadcastEventsChanged();
		},
	);

	secureHandle(IpcChannels.Storage.DeleteEvent, ipcIdArgs, (id: string) => {
		deleteEvent(id);
		broadcastEventsChanged();
	});

	secureHandle(
		IpcChannels.Storage.FinalizeOnboardingEvent,
		ipcIdArgs,
		(id: string) => {
			const event = getEventById(id);
			if (!event) return;

			updateEvent(id, {
				appName: "Screencap",
				appBundleId: "com.screencap.app",
				category: "Chores",
				subcategories: "Setup",
				caption: "Completing onboarding — your journey with Screencap begins",
				windowTitle: "Welcome to Screencap",
				status: "completed",
				confidence: 0.95,
				tags: "onboarding,first-capture",
			});
			broadcastEventUpdated(id);
		},
	);

	secureHandle(
		IpcChannels.Storage.GetMemories,
		ipcGetMemoriesArgs,
		(type?: string) => {
			return getMemories(type);
		},
	);

	secureHandle(
		IpcChannels.Storage.InsertMemory,
		ipcInsertMemoryArgs,
		(memory: Memory) => {
			insertMemory(memory);

			if (memory.type === "project") {
				const result = normalizeProjectsInDb();
				if (result.updatedRows > 0) {
					logger.info("Normalized projects after memory insert", result);
				}
				broadcastProjectsNormalized(result);
			}
		},
	);

	secureHandle(
		IpcChannels.Storage.UpdateMemory,
		ipcUpdateMemoryArgs,
		(id: string, updates: { content: string; description?: string | null }) => {
			const existing = getMemoryById(id);
			const type = existing?.type ?? getMemoryType(id);
			updateMemory(id, updates);

			if (type === "project") {
				const result = normalizeProjectsInDb();
				if (result.updatedRows > 0) {
					logger.info("Normalized projects after memory update", result);
				}
				broadcastProjectsNormalized(result);
			}

			if (
				type === "addiction" &&
				existing?.content &&
				existing.content !== updates.content
			) {
				const updatedRows = updateAddictionName(
					existing.content,
					updates.content,
				);
				if (updatedRows > 0) broadcastEventsChanged();
			}
		},
	);

	secureHandle(IpcChannels.Storage.DeleteMemory, ipcIdArgs, (id: string) => {
		const type = getMemoryType(id);
		deleteMemory(id);

		if (type === "project") {
			const result = normalizeProjectsInDb();
			if (result.updatedRows > 0) {
				logger.info("Normalized projects after memory delete", result);
			}
			broadcastProjectsNormalized(result);
		}
	});

	secureHandle(IpcChannels.Storage.GetCategories, ipcNoArgs, () => {
		return getDistinctCategories();
	});

	secureHandle(IpcChannels.Storage.GetProjects, ipcNoArgs, () => {
		return getDistinctProjects();
	});

	secureHandle(IpcChannels.Storage.GetApps, ipcNoArgs, () => {
		const result = getDistinctApps();
		for (const a of result) {
			if (!a.appIconPath) {
				void ensureAppIcon(a.bundleId);
			}
		}
		return result;
	});

	secureHandle(IpcChannels.Storage.GetWebsites, ipcNoArgs, () => {
		const result = listWebsitesWithFavicons();
		for (const w of result) {
			if (!w.faviconPath) {
				void ensureFavicon(w.host, null);
			}
		}
		return result;
	});

	secureHandle(
		IpcChannels.Storage.GetTimelineFacets,
		ipcGetTimelineFacetsArgs,
		(options: GetTimelineFacetsOptions) => {
			const projects = getDistinctProjectsInRange(options);
			const websites = listWebsitesWithFaviconsInRange(options);
			const apps = getDistinctAppsInRange(options);
			for (const w of websites) {
				if (!w.faviconPath) {
					void ensureFavicon(w.host, null);
				}
			}
			for (const a of apps) {
				if (!a.appIconPath) {
					void ensureAppIcon(a.bundleId);
				}
			}
			return { projects, websites, apps };
		},
	);

	secureHandle(
		IpcChannels.Storage.GetStats,
		ipcGetStatsArgs,
		(startDate: number, endDate: number) => {
			return getCategoryStats(startDate, endDate);
		},
	);

	secureHandle(
		IpcChannels.Storage.GetStories,
		ipcGetStoriesArgs,
		(periodType?: string) => {
			return getStories(periodType);
		},
	);

	secureHandle(
		IpcChannels.Storage.InsertStory,
		ipcInsertStoryArgs,
		(story: StoryInput) => {
			insertStory(story);
		},
	);

	secureHandle(
		IpcChannels.Storage.GetAddictionStatsBatch,
		ipcGetStatsBatchArgs,
		(names: string[]) => {
			return getAddictionStatsBatch(names);
		},
	);

	secureHandle(
		IpcChannels.Storage.GetProjectStatsBatch,
		ipcGetStatsBatchArgs,
		(names: string[]) => {
			return getProjectStatsBatch(names);
		},
	);
}
