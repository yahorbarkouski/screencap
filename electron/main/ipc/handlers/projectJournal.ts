import { IpcChannels } from "../../../shared/ipc";
import {
	attachRepoToProject,
	detachRepoFromProject,
	getProjectGitActivity,
	listReposForProject,
} from "../../features/projectJournal/ProjectJournalService";
import { secureHandle } from "../secure";
import {
	ipcProjectJournalAttachRepoArgs,
	ipcProjectJournalDetachRepoArgs,
	ipcProjectJournalGetActivityArgs,
	ipcProjectJournalListReposArgs,
} from "../validation";

export function registerProjectJournalHandlers(): void {
	secureHandle(
		IpcChannels.ProjectJournal.ListRepos,
		ipcProjectJournalListReposArgs,
		(projectName: string) => {
			return listReposForProject(projectName);
		},
	);

	secureHandle(
		IpcChannels.ProjectJournal.AttachRepo,
		ipcProjectJournalAttachRepoArgs,
		async (projectName: string, path: string) => {
			return await attachRepoToProject({ projectName, path });
		},
	);

	secureHandle(
		IpcChannels.ProjectJournal.DetachRepo,
		ipcProjectJournalDetachRepoArgs,
		(repoId: string) => {
			detachRepoFromProject(repoId);
		},
	);

	secureHandle(
		IpcChannels.ProjectJournal.GetActivity,
		ipcProjectJournalGetActivityArgs,
		async (options: {
			projectName: string;
			startAt: number;
			endAt: number;
			limitPerRepo?: number;
		}) => {
			return await getProjectGitActivity(options);
		},
	);
}
