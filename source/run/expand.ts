/**
 * Expand a config's targets into concrete repositories. Explicit `repo:`
 * targets pass through; `pattern:` targets are matched against the owner's
 * repositories (listed via an injected {@link RepoLister}). A repo that matches
 * several targets is audited once, with the union of their rule packs.
 */

import type {Target} from '../config/types.js';
import {matchesGlob} from '../rule-packs/glob.js';
import type {RepoLister} from './repo-lister.js';

/** A concrete repository to audit, with its assigned rule packs. */
export interface ResolvedRepoTarget {
	repo: string;
	rulePacks: string[];
}

/** The outcome of expanding targets. */
export interface ExpandResult {
	targets: ResolvedRepoTarget[];
	/** Reasons a target could not be expanded (missing lister, list failure). */
	errors: string[];
}

function addRepo(
	byRepo: Map<string, Set<string>>,
	repo: string,
	rulePacks: string[],
): void {
	const packs = byRepo.get(repo) ?? new Set<string>();
	for (const pack of rulePacks) {
		packs.add(pack);
	}
	byRepo.set(repo, packs);
}

/**
 * Expand `config.targets`. Pattern targets need a lister; without one they are
 * recorded as errors and skipped. The owner is the segment before the first
 * `/` in the pattern (e.g. `my-org` for `my-org/web-*`).
 */
export async function expandTargets(
	targets: Target[],
	lister?: RepoLister,
): Promise<ExpandResult> {
	const byRepo = new Map<string, Set<string>>();
	const errors: string[] = [];
	const listed = new Map<string, string[]>();

	for (const target of targets) {
		if (target.repo) {
			addRepo(byRepo, target.repo, target.rulePacks);
			continue;
		}
		if (!target.pattern) {
			continue;
		}

		const pattern = target.pattern;
		if (!lister) {
			errors.push(
				`cannot expand pattern "${pattern}" — no repo lister available (needs a GitHub token)`,
			);
			continue;
		}

		const owner = pattern.split('/')[0];
		if (!owner) {
			errors.push(`invalid pattern "${pattern}" — expected owner/glob`);
			continue;
		}

		let repos = listed.get(owner);
		if (!repos) {
			try {
				repos = await lister.list(owner);
				listed.set(owner, repos);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				errors.push(`failed to list repos for "${owner}": ${message}`);
				continue;
			}
		}

		const matched = repos.filter(repo => matchesGlob(pattern, repo));
		for (const repo of matched) {
			addRepo(byRepo, repo, target.rulePacks);
		}
	}

	const resolved: ResolvedRepoTarget[] = [...byRepo.entries()].map(
		([repo, packs]) => ({repo, rulePacks: [...packs]}),
	);
	return {targets: resolved, errors};
}
