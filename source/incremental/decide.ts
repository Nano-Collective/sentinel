/**
 * Decide, per pack, whether this run may skip files — and which.
 *
 * Every branch here defaults to a full pass. That asymmetry is the whole design:
 * being wrong about *needing* to re-read costs some model time, while being
 * wrong about *not* needing to costs a missed vulnerability and, because
 * reconciliation ages out what it does not see, eventually an issue closed as
 * fixed. The cheap mistake and the expensive one are not close, so anything
 * uncertain reads everything.
 */

import {createHash} from 'node:crypto';
import {matchesGlob} from '../rule-packs/glob.js';
import type {RulePack} from '../rule-packs/types.js';
import type {PackCacheEntry} from './types.js';

/** A stable hash of a pack's audit body, for detecting an edited prompt. */
export function packBodyHash(pack: RulePack): string {
	return createHash('sha256').update(pack.body).digest('hex').slice(0, 16);
}

/**
 * A combined hash over the bodies of a pack's dependencies, in the order the
 * resolver produced them. Order is part of the prompt, so a reordering is a
 * change; packs with no dependencies all hash alike, which is correct.
 */
export function dependencyHash(dependencies: RulePack[]): string {
	const hash = createHash('sha256');
	for (const dependency of dependencies) {
		hash.update(dependency.manifest.name).update('\u0000');
		hash.update(dependency.body).update('\u0000');
	}
	return hash.digest('hex').slice(0, 16);
}

/** Why a pack is reading everything, for the run report. */
export type FullReason =
	| 'incremental-disabled'
	| 'forced'
	| 'no-cache'
	| 'pack-changed'
	| 'dependency-changed'
	| 'sha-unreachable';

/** What one pack should read this run. */
export type PackScanPlan =
	| {kind: 'full'; reason: FullReason}
	| {kind: 'partial'; paths: string[]};

/** The repository facts the decision needs, injected so it stays testable. */
export interface GitProbe {
	/** The repository's current commit, or null if it cannot be determined. */
	head(repoDir: string): string | null;
	/**
	 * Paths changed between `sha` and the current commit, or null when the diff
	 * cannot be taken — an unknown commit, a shallow clone, a force-push that
	 * orphaned it. Null means "cannot tell", which is not the same as "nothing
	 * changed", and the two must never collapse.
	 */
	changedSince(repoDir: string, sha: string): string[] | null;
}

/** Everything needed to decide one pack's scope. */
export interface DecideInput {
	pack: RulePack;
	repoDir: string;
	/** This target's cache entry for this pack, if there is one. */
	cached?: PackCacheEntry;
	/** The packs this one depends on, already resolved, in prompt order. */
	dependencies: RulePack[];
	/** The target opted in to incremental scanning. */
	incremental: boolean;
	/** `--full` was passed: audit everything regardless. */
	forced: boolean;
	probe: GitProbe;
}

function full(reason: FullReason): PackScanPlan {
	return {kind: 'full', reason};
}

/**
 * Decide what one pack reads this run.
 *
 * A partial plan is only ever returned when the cache names a commit that is
 * still reachable, the pack is byte-identical to the one that produced it, and
 * every pack it depends on is too. Anything else reads everything.
 */
export function decidePackScope(input: DecideInput): PackScanPlan {
	if (!input.incremental) {
		return full('incremental-disabled');
	}
	if (input.forced) {
		return full('forced');
	}
	if (!input.cached) {
		return full('no-cache');
	}
	if (
		input.cached.packVersion !== input.pack.manifest.version ||
		input.cached.bodyHash !== packBodyHash(input.pack)
	) {
		return full('pack-changed');
	}
	// A dependency's body is part of this pack's prompt, so an edit to one is an
	// edit to this pack's question. Without this, changing a shared `rust-general`
	// pack would leave every dependent still answering the old one against files
	// it had already decided were unchanged.
	if (input.cached.dependencyHash !== dependencyHash(input.dependencies)) {
		return full('dependency-changed');
	}

	const changed = input.probe.changedSince(input.repoDir, input.cached.sha);
	if (changed === null) {
		return full('sha-unreachable');
	}

	// Narrow the diff to what this pack actually applies to. An empty pattern
	// list means the whole repository, matching `RepoFiles.read`.
	const patterns = input.pack.manifest.appliesTo.paths;
	const paths =
		patterns.length === 0
			? changed
			: changed.filter(path =>
					patterns.some(pattern => matchesGlob(pattern, path)),
				);
	return {kind: 'partial', paths};
}

/** A human sentence for the run report, so a full pass is never a mystery. */
export function explainFullReason(reason: FullReason): string {
	switch (reason) {
		case 'incremental-disabled':
			return 'incremental scanning is not enabled for this target';
		case 'forced':
			return '--full was passed';
		case 'no-cache':
			return 'no cached scan to compare against';
		case 'pack-changed':
			return 'the rule pack changed since the last pass';
		case 'dependency-changed':
			return 'a pack it depends on changed since the last pass';
		case 'sha-unreachable':
			return 'the cached commit is unreachable, so nothing could be diffed';
	}
}
