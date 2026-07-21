/**
 * Clone target repositories into the run workspace. The audited repos are named
 * in sentinel.yaml, not known to the workflow statically, so `sentinel run`
 * clones any that are not already present. Arg building is pure and tested; the
 * gh spawn and fs checks are not.
 */

import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

/** Build the `gh repo clone` argv for a shallow single-branch clone. */
export function buildCloneArgs(repo: string, dir: string): string[] {
	return ['repo', 'clone', repo, dir, '--', '--depth', '1', '--single-branch'];
}

/** The outcome of ensuring the target repos are present in the workspace. */
export interface EnsureTargetsResult {
	cloned: string[];
	skipped: string[];
	errors: {repo: string; error: string}[];
}

/* c8 ignore start -- spawns gh and touches the filesystem. */
/**
 * Ensure each repo is checked out under `workspaceDir/<owner>/<name>`, cloning
 * any that are missing. Repos already present are left untouched.
 */
export function ensureTargets(
	repos: string[],
	workspaceDir: string,
): EnsureTargetsResult {
	const result: EnsureTargetsResult = {cloned: [], skipped: [], errors: []};

	for (const repo of repos) {
		const dir = join(workspaceDir, repo);
		if (existsSync(dir)) {
			result.skipped.push(repo);
			continue;
		}
		const run = spawnSync('gh', buildCloneArgs(repo, dir), {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		});
		if (run.error) {
			const code = (run.error as NodeJS.ErrnoException).code;
			result.errors.push({
				repo,
				error:
					code === 'ENOENT'
						? '`gh` is not on PATH. Install the GitHub CLI.'
						: String(run.error),
			});
		} else if (run.status !== 0) {
			result.errors.push({repo, error: (run.stderr ?? '').trim()});
		} else {
			result.cloned.push(repo);
		}
	}

	return result;
}
/* c8 ignore stop */
