import { z } from "zod";
import { IpcChannels } from "../../../shared/ipc";
import type { CreateShareResult, ProjectShare } from "../../../shared/types";
import {
	backfillEvents,
	createShare,
	disableShare,
	getShare,
} from "../../features/publishing/PublishingService";
import { secureHandle } from "../secure";

const stringArg = z.tuple([z.string()]);

export function registerPublishingHandlers(): void {
	secureHandle(
		IpcChannels.Publishing.CreateShare,
		stringArg,
		async (projectName: string): Promise<CreateShareResult> => {
			const result = await createShare(projectName);
			void backfillEvents(projectName, 50);
			return result;
		},
	);

	secureHandle(
		IpcChannels.Publishing.GetShare,
		stringArg,
		(projectName: string): ProjectShare | null => {
			return getShare(projectName);
		},
	);

	secureHandle(
		IpcChannels.Publishing.DisableShare,
		stringArg,
		(projectName: string): void => {
			disableShare(projectName);
		},
	);

	secureHandle(
		IpcChannels.Publishing.SyncShare,
		stringArg,
		async (projectName: string): Promise<number> => {
			return backfillEvents(projectName, 100);
		},
	);
}
