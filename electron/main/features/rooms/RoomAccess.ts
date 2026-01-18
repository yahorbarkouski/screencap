import { deleteProjectRoomLinkByRoomId } from "../../infra/db/repositories/ProjectRoomLinkRepository";
import { deleteCachedDayWrapped } from "../../infra/db/repositories/RoomDayWrappedCacheRepository";
import { deleteCachedRoomEvents } from "../../infra/db/repositories/RoomEventsCacheRepository";
import { deleteSentInvitesForRoom } from "../../infra/db/repositories/RoomInvitesSentRepository";
import { deleteRoomKeyCache } from "../../infra/db/repositories/RoomKeysCacheRepository";
import { deleteRoomMembers } from "../../infra/db/repositories/RoomMembersCacheRepository";
import { deleteRoomMembership } from "../../infra/db/repositories/RoomMembershipsRepository";
import { createLogger } from "../../infra/log";

const logger = createLogger({ scope: "RoomAccess" });
const FORBIDDEN_PATTERN = /\b403\b/;

function isForbiddenStatus(value: unknown): boolean {
	return value === 403 || value === "403";
}

function hasForbiddenStatus(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (isForbiddenStatus(record.status)) return true;
	if (isForbiddenStatus(record.statusCode)) return true;
	const response = record.response;
	if (response && typeof response === "object") {
		const responseRecord = response as Record<string, unknown>;
		if (isForbiddenStatus(responseRecord.status)) return true;
	}
	const cause = record.cause;
	if (cause && typeof cause === "object") {
		const causeRecord = cause as Record<string, unknown>;
		if (isForbiddenStatus(causeRecord.status)) return true;
		if (isForbiddenStatus(causeRecord.statusCode)) return true;
		const causeResponse = causeRecord.response;
		if (causeResponse && typeof causeResponse === "object") {
			const responseRecord = causeResponse as Record<string, unknown>;
			if (isForbiddenStatus(responseRecord.status)) return true;
		}
	}
	return false;
}

export function isForbiddenError(error: unknown): boolean {
	if (!error) return false;
	if (hasForbiddenStatus(error)) return true;
	const message = error instanceof Error ? error.message : String(error);
	return FORBIDDEN_PATTERN.test(message);
}

export function removeRoomAccess(roomId: string): void {
	deleteProjectRoomLinkByRoomId(roomId);
	deleteCachedRoomEvents(roomId);
	deleteCachedDayWrapped(roomId);
	deleteRoomKeyCache(roomId);
	deleteRoomMembers(roomId);
	deleteSentInvitesForRoom(roomId);
	deleteRoomMembership(roomId);
}

export function handleForbiddenRoomError(params: {
	roomId: string;
	error: unknown;
	source: string;
}): boolean {
	if (!isForbiddenError(params.error)) return false;
	removeRoomAccess(params.roomId);
	logger.warn("Removed room access after forbidden response", {
		roomId: params.roomId,
		source: params.source,
		error: String(params.error),
	});
	return true;
}
