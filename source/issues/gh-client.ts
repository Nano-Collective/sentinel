/**
 * The real {@link GitHubClient}, backed by the `gh` CLI. In GitHub Actions `gh`
 * is preinstalled and authenticated from the workflow token; locally it uses
 * the user's `gh auth` session. Arg building is pure and tested; the spawn and
 * URL parsing are not.
 */

import {spawnSync} from 'node:child_process';
import type {CreatedIssue, CreateIssueParams, GitHubClient} from './types.js';

/** Build the `gh issue create` argv for the given params. Pure and tested. */
export function buildGhIssueArgs(params: CreateIssueParams): string[] {
	const args = [
		'issue',
		'create',
		'--repo',
		params.repo,
		'--title',
		params.title,
		'--body',
		params.body,
	];
	for (const label of params.labels) {
		args.push('--label', label);
	}
	for (const assignee of params.assignees) {
		args.push('--assignee', assignee);
	}
	return args;
}

/** Parse the issue number from the URL `gh issue create` prints on success. */
export function parseIssueUrl(output: string): CreatedIssue | null {
	const url = output.trim().split('\n').pop()?.trim() ?? '';
	const match = url.match(/\/issues\/(\d+)\s*$/);
	if (!match) {
		return null;
	}
	return {number: Number(match[1]), url};
}

/* c8 ignore start -- spawns the gh CLI; not exercised in unit tests. */
export const ghIssueClient: GitHubClient = {
	async createIssue(params: CreateIssueParams): Promise<CreatedIssue> {
		const result = spawnSync('gh', buildGhIssueArgs(params), {
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
				`gh issue create failed (status ${result.status}): ${result.stderr ?? ''}`.trim(),
			);
		}

		const created = parseIssueUrl(result.stdout ?? '');
		if (!created) {
			throw new Error(
				`could not parse issue URL from gh output: ${result.stdout ?? ''}`,
			);
		}
		return created;
	},
};
/* c8 ignore stop */
