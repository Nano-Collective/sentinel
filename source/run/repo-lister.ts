/**
 * List an owner's repositories so `pattern:` targets can be expanded into
 * concrete repos. Injectable (RepoLister) so target expansion is testable
 * without the GitHub API; the real implementation shells out to `gh`.
 */

import {spawnSync} from 'node:child_process';

/** Lists the repositories under a GitHub owner (org or user). */
export interface RepoLister {
	/** Return `owner/name` for every non-archived repo under `owner`. */
	list(owner: string): Promise<string[]>;
}

/** Build the `gh repo list` argv. Pure and tested. */
export function buildRepoListArgs(owner: string): string[] {
	return [
		'repo',
		'list',
		owner,
		'--limit',
		'1000',
		'--json',
		'nameWithOwner,isArchived',
	];
}

/** Parse `gh repo list --json ...` output, dropping archived repos. */
export function parseRepoList(json: string): string[] {
	const raw = JSON.parse(json) as Array<{
		nameWithOwner: string;
		isArchived: boolean;
	}>;
	return raw.filter(repo => !repo.isArchived).map(repo => repo.nameWithOwner);
}

/* c8 ignore start -- spawns the gh CLI; not exercised in unit tests. */
export const ghRepoLister: RepoLister = {
	async list(owner: string): Promise<string[]> {
		const result = spawnSync('gh', buildRepoListArgs(owner), {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		});
		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				throw new Error('`gh` is not on PATH. Install the GitHub CLI.');
			}
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(
				`gh repo list ${owner} failed (status ${result.status}): ${(result.stderr ?? '').trim()}`,
			);
		}
		return parseRepoList(result.stdout ?? '');
	},
};
/* c8 ignore stop */
