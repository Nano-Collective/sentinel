/**
 * The real git probe. The only part of incremental scanning that shells out;
 * the decision logic takes this as an interface so it stays testable.
 */

import {spawnSync} from 'node:child_process';
import type {GitProbe} from './decide.js';

/* c8 ignore start -- spawns git against a real checkout. */
function git(repoDir: string, args: string[]): string | null {
	const run = spawnSync('git', ['-C', repoDir, ...args], {
		encoding: 'utf8',
		timeout: 30_000,
	});
	if (run.error || run.status !== 0) {
		return null;
	}
	return run.stdout.trim();
}

export const gitProbe: GitProbe = {
	head(repoDir) {
		return git(repoDir, ['rev-parse', 'HEAD']);
	},

	changedSince(repoDir, sha) {
		// Verify the commit is actually present before diffing. A shallow clone
		// has the ref but not the object, and `git diff` against a missing commit
		// fails — which must read as "cannot tell", never as "nothing changed".
		if (git(repoDir, ['cat-file', '-e', `${sha}^{commit}`]) === null) {
			return null;
		}
		const out = git(repoDir, ['diff', '--name-only', sha, 'HEAD']);
		if (out === null) {
			return null;
		}
		// Untracked files are changes too: a file added since the last pass and
		// not yet committed has never been audited, and `git diff` will not
		// mention it.
		const untracked =
			git(repoDir, ['ls-files', '--others', '--exclude-standard']) ?? '';
		const paths = [...out.split('\n'), ...untracked.split('\n')]
			.map(line => line.trim())
			.filter(line => line.length > 0);
		return [...new Set(paths)];
	},
};
/* c8 ignore stop */
