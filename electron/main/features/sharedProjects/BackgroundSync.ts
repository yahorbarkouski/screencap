import { createLogger } from "../../infra/log";
import { getIdentity } from "../social/IdentityService";
import { syncAllRooms } from "./SharedProjectsService";

const logger = createLogger({ scope: "SharedProjectsBackgroundSync" });

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let syncInterval: NodeJS.Timeout | null = null;

async function runSync(): Promise<void> {
	const identity = getIdentity();
	if (!identity) return;

	try {
		await syncAllRooms();
	} catch (error) {
		logger.warn("Background sync failed", { error: String(error) });
	}
}

export function startBackgroundSync(): void {
	if (syncInterval) return;

	setTimeout(() => {
		void runSync();
	}, 10_000);

	syncInterval = setInterval(() => {
		void runSync();
	}, SYNC_INTERVAL_MS);

	logger.info("Background sync started", {
		intervalMs: SYNC_INTERVAL_MS,
	});
}

export function stopBackgroundSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
		logger.info("Background sync stopped");
	}
}
