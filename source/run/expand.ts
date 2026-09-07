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
	/**
	 * True only when *every* target that contributed to this repo asked for
	 * incremental scanning. A repo can match several targets, and one of them
	 * expecting a complete re-read has to win — the alternative is a target
	 * silently having its files skipped because an unrelated pattern opted in.
	 */
	incremental: boolean;
}

/** The outcome of expanding targets. */
export interface ExpandResult {
	targets: ResolvedRepoTarget[];
	/** Reasons a target could not be expanded (missing lister, list failure). */
	errors: string[];
}

interface Accumulated {
	packs: Set<string>;
	incremental: boolean;
}

function addRepo(
	byRepo: Map<string, Accumulated>,
	repo: string,
	target: Target,
): void {
	const existing = byRepo.get(repo);
	const packs = existing?.packs ?? new Set<string>();
	for (const pack of target.rulePacks) {
		packs.add(pack);
	}
	const incremental = target.incremental === true;
	byRepo.set(repo, {
		packs,
		// AND, not OR: every contributing target must have opted in.
		incremental: existing ? existing.incremental && incremental : incremental,
	});
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
	const byRepo = new Map<string, Accumulated>();
	const errors: string[] = [];
	const listed = new Map<string, string[]>();

	for (const target of targets) {
		if (target.repo) {
			addRepo(byRepo, target.repo, target);
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
			addRepo(byRepo, repo, target);
		}
	}

	const resolved: ResolvedRepoTarget[] = [...byRepo.entries()].map(
		([repo, {packs, incremental}]) => ({
			repo,
			rulePacks: [...packs],
			incremental,
		}),
	);
	return {targets: resolved, errors};
}
