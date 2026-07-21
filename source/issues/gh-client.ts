/**
 * The real {@link GitHubClient}, backed by the `gh` CLI. In GitHub Actions `gh`
 * is preinstalled and authenticated from the workflow token; locally it uses
 * the user's `gh auth` session. Arg building is pure and tested; the spawn and
 * URL parsing are not.
 */

import {spawnSync} from 'node:child_process';
import type {
	CreatedIssue,
	CreateIssueParams,
	ExistingIssue,
	ReconcileClient,
} from './types.js';

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

/** Build the `gh issue list` argv that returns the JSON dedup needs. */
export function buildGhListArgs(repo: string, label: string): string[] {
	return [
		'issue',
		'list',
		'--repo',
		repo,
		'--label',
		label,
		'--state',
		'all',
		'--limit',
		'1000',
		'--json',
		'number,url,state,labels,body',
	];
}

/** Build the `gh issue edit` argv that replaces an issue body. */
export function buildGhEditArgs(
	repo: string,
	issueNumber: number,
	body: string,
): string[] {
	return ['issue', 'edit', String(issueNumber), '--repo', repo, '--body', body];
}

/** Build the `gh issue close` argv. */
export function buildGhCloseArgs(
	repo: string,
	issueNumber: number,
	reason?: string,
	comment?: string,
): string[] {
	const args = ['issue', 'close', String(issueNumber), '--repo', repo];
	if (reason) {
		args.push('--reason', reason);
	}
	if (comment) {
		args.push('--comment', comment);
	}
	return args;
}

/** Build the `gh label create` argv (idempotent via --force). */
export function buildGhLabelArgs(repo: string, label: string): string[] {
	return [
		'label',
		'create',
		label,
		'--repo',
		repo,
		'--color',
		'5319e7',
		'--description',
		'Managed by Sentinel',
		'--force',
	];
}

/** Parse the JSON `gh issue list --json ...` prints into ExistingIssues. */
export function parseIssueList(json: string): ExistingIssue[] {
	const raw = JSON.parse(json) as Array<{
		number: number;
		url: string;
		state: string;
		labels: Array<{name: string}>;
		body: string;
	}>;
	return raw.map(item => ({
		number: item.number,
		url: item.url,
		state: item.state.toLowerCase() === 'open' ? 'open' : 'closed',
		labels: item.labels.map(label => label.name),
		body: item.body,
	}));
}

/* c8 ignore start -- spawns the gh CLI; not exercised in unit tests. */
function runGh(args: string[]): {
	status: number;
	stdout: string;
	stderr: string;
} {
	const result = spawnSync('gh', args, {
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
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

export const ghIssueClient: ReconcileClient = {
	async createIssue(params: CreateIssueParams): Promise<CreatedIssue> {
		const result = runGh(buildGhIssueArgs(params));
		if (result.status !== 0) {
			throw new Error(
				`gh issue create failed (status ${result.status}): ${result.stderr}`.trim(),
			);
		}
		const created = parseIssueUrl(result.stdout);
		if (!created) {
			throw new Error(
				`could not parse issue URL from gh output: ${result.stdout}`,
			);
		}
		return created;
	},

	async ensureLabels({repo, labels}): Promise<void> {
		// Best effort: a label that already exists or a transient failure must not
		// abort the run — filing tolerates a missing label per issue.
		for (const label of labels) {
			runGh(buildGhLabelArgs(repo, label));
		}
	},

	async listIssues({repo, label}): Promise<ExistingIssue[]> {
		const result = runGh(buildGhListArgs(repo, label));
		if (result.status !== 0) {
			throw new Error(
				`gh issue list failed (status ${result.status}): ${result.stderr}`.trim(),
			);
		}
		return parseIssueList(result.stdout);
	},

	async updateIssue({repo, number, body}): Promise<void> {
		const result = runGh(buildGhEditArgs(repo, number, body));
		if (result.status !== 0) {
			throw new Error(
				`gh issue edit failed (status ${result.status}): ${result.stderr}`.trim(),
			);
		}
	},

	async closeIssue({repo, number, reason, comment}): Promise<void> {
		const result = runGh(buildGhCloseArgs(repo, number, reason, comment));
		if (result.status !== 0) {
			throw new Error(
				`gh issue close failed (status ${result.status}): ${result.stderr}`.trim(),
			);
		}
	},
};
/* c8 ignore stop */
