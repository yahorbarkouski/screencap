import type { GitCommit, ProjectRepo } from "../../../shared/types";
import { getEarliestEventTimestampForProject } from "../../infra/db/repositories/EventRepository";
import { getProjectMemories } from "../../infra/db/repositories/MemoryRepository";
import {
	deleteProjectRepoById,
	findProjectRepoByKeyAndRoot,
	insertProjectRepo,
	listProjectReposByProjectKey,
} from "../../infra/db/repositories/ProjectRepoRepository";
import {
	canonicalizeProject,
	normalizeProjectBase,
	projectKeyFromBase,
} from "../projects";
import { listCommitsInRange, resolveRepoRoot } from "./GitService";

function requireProjectIdentity(projectName: string): {
	projectName: string;
	projectKey: string;
} {
	const canonical = canonicalizeProject(projectName) ?? projectName.trim();
	const base = canonical.trim();
	if (!base) {
		throw new Error("Invalid project");
	}
	const key = projectKeyFromBase(base);
	if (!key) {
		throw new Error("Invalid project");
	}
	return { projectName: base, projectKey: key };
}

function resolveProjectCreatedAt(projectKey: string): number | null {
	const memories = getProjectMemories();
	let createdAt: number | null = null;

	for (const m of memories) {
		const base = normalizeProjectBase(m.content);
		const key = projectKeyFromBase(base);
		if (!key || key !== projectKey) continue;
		createdAt =
			createdAt === null ? m.createdAt : Math.min(createdAt, m.createdAt);
	}

	return createdAt;
}

export async function attachRepoToProject(options: {
	projectName: string;
	path: string;
}): Promise<ProjectRepo> {
	const { projectName, projectKey } = requireProjectIdentity(
		options.projectName,
	);

	const resolved = await resolveRepoRoot(options.path);
	if (!resolved.ok) {
		throw new Error("Not a git repository");
	}
	const repoRoot = resolved.repoRoot;

	const existing = findProjectRepoByKeyAndRoot(projectKey, repoRoot);
	if (existing) return existing;

	const repo: ProjectRepo = {
		id: crypto.randomUUID(),
		projectKey,
		projectName,
		repoRoot,
		createdAt: Date.now(),
	};

	insertProjectRepo(repo);
	return repo;
}

export function detachRepoFromProject(repoId: string): void {
	deleteProjectRepoById(repoId);
}

export function listReposForProject(projectName: string): ProjectRepo[] {
	const { projectKey } = requireProjectIdentity(projectName);
	return listProjectReposByProjectKey(projectKey);
}

export async function getProjectGitActivity(options: {
	projectName: string;
	startAt: number;
	endAt: number;
	limitPerRepo?: number;
}): Promise<{
	repos: ProjectRepo[];
	commits: GitCommit[];
}> {
	const { projectName, projectKey } = requireProjectIdentity(
		options.projectName,
	);
	const repos = listProjectReposByProjectKey(projectKey);

	const createdAt = resolveProjectCreatedAt(projectKey);
	const earliestEventAt = getEarliestEventTimestampForProject(projectName);
	const backfillStartAt = createdAt ?? earliestEventAt ?? 0;

	const requestedStartAt =
		options.startAt > 0 ? options.startAt : backfillStartAt;
	const startAt = Math.max(requestedStartAt, backfillStartAt);
	const endAt = options.endAt > 0 ? options.endAt : Date.now();
	const limitPerRepo = options.limitPerRepo;

	const commits: GitCommit[] = [];

	for (const repo of repos) {
		const repoCommits = await listCommitsInRange({
			repoRoot: repo.repoRoot,
			startAt,
			endAt,
			limit: limitPerRepo,
		});
		for (const c of repoCommits) {
			commits.push({ ...c, projectRepoId: repo.id });
		}
	}

	commits.sort((a, b) => b.timestamp - a.timestamp);

	return { repos, commits };
}
