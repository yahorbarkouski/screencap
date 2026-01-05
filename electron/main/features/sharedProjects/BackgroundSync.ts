import { createLogger } from "../../infra/log";
import { repairAllRoomKeyEnvelopes } from "../rooms/RoomsService";
import { getIdentity } from "../social/IdentityService";
import { syncAllRooms } from "./SharedProjectsService";

const logger = createLogger({ scope: "SharedProjectsBackgroundSync" });

const SYNC_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 5_000;

let syncInterval: NodeJS.Timeout | null = null;
let hasRunRepair = false;

async function runSync(): Promise<void> {
	const identity = getIdentity();
	if (!identity) return;

	if (!hasRunRepair) {
		hasRunRepair = true;
		try {
			await repairAllRoomKeyEnvelopes();
		} catch (error) {
			logger.warn("Key envelope repair failed", { error: String(error) });
		}
	}

	try {
		await syncAllRooms();
	} catch (error) {
		logger.warn("Background sync failed", { error: String(error) });
	}
}

export function startBackgroundSync(): void {
	if (syncInterval) return;

	setTimeout(() => void runSync(), INITIAL_DELAY_MS);

	syncInterval = setInterval(() => void runSync(), SYNC_INTERVAL_MS);

	logger.info("Background sync started", { intervalMs: SYNC_INTERVAL_MS });
}

export function stopBackgroundSync(): void {
	if (!syncInterval) return;
	clearInterval(syncInterval);
	syncInterval = null;
	logger.info("Background sync stopped");
}
