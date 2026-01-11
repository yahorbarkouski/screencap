import { updateEvent } from "../../infra/db/repositories/EventRepository";
import { deleteCachedRoomEventById } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { createLogger } from "../../infra/log";
import { signedFetch } from "../social/IdentityService";
import { publishEventToRoom } from "../sync/RoomSyncService";
import { ensureFriendsFeedRoom } from "./FriendsFeedRoomService";

const logger = createLogger({ scope: "SocialFeedPublishService" });

export async function publishEventToAllFriends(eventId: string): Promise<void> {
	const roomId = await ensureFriendsFeedRoom();
	await publishEventToRoom({ roomId, eventId });
	updateEvent(eventId, { sharedToFriends: 1 });
}

export async function unpublishEventFromFriends(
	eventId: string,
): Promise<void> {
	const roomId = await ensureFriendsFeedRoom({ reconcileInvites: false });

	const res = await signedFetch(`/api/rooms/${roomId}/events/${eventId}`, {
		method: "DELETE",
	});

	if (!res.ok && res.status !== 404) {
		const text = await res.text();
		throw new Error(`Failed to unpublish event: ${res.status} ${text}`);
	}

	deleteCachedRoomEventById(eventId);
	updateEvent(eventId, { sharedToFriends: 0 });

	logger.info("Unpublished event from friends feed", { eventId, roomId });
}
