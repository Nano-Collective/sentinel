/**
 * Clone target repositories into the run workspace. The audited repos are named
 * in sentinel.yaml, not known to the workflow statically, so `sentinel run`
 * clones any that are not already present. Arg building is pure and tested; the
 * gh spawn and fs checks are not.
 */

import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

/** Build the `gh repo clone` argv for a shallow single-branch clone. */
export function buildCloneArgs(repo: string, dir: string): string[] {
	return ['repo', 'clone', repo, dir, '--', '--depth', '1', '--single-branch'];
}

/** The outcome of ensuring one repo is present in the workspace. */
export interface PrepareResult {
	ok: boolean;
	/** True if the repo was already present and no clone was attempted. */
	skipped: boolean;
	error?: string;
}

/* c8 ignore start -- spawns gh and touches the filesystem. */
/**
 * Ensure a single repo is checked out at `dir`, cloning it if missing. Returns
 * a result rather than throwing so one failure does not abort a run.
 */
export async function prepareRepo(
	repo: string,
	dir: string,
): Promise<PrepareResult> {
	if (existsSync(dir)) {
		return {ok: true, skipped: true};
	}
	const run = spawnSync('gh', buildCloneArgs(repo, dir), {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
	if (run.error) {
		const code = (run.error as NodeJS.ErrnoException).code;
		return {
			ok: false,
			skipped: false,
			error:
				code === 'ENOENT'
					? '`gh` is not on PATH. Install the GitHub CLI.'
					: String(run.error),
		};
	}
	if (run.status !== 0) {
		return {ok: false, skipped: false, error: (run.stderr ?? '').trim()};
	}
	return {ok: true, skipped: false};
}
/* c8 ignore stop */
