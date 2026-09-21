/**
 * The dedup planner. Given this run's findings and the issues that already
 * exist on the target repo, decide what to do with each: file a new issue,
 * touch (reset) an existing one, suppress it (a maintainer closed it with a
 * suppression label), hold one whose file this run did not read, or resolve a
 * stale issue whose finding has been absent for enough consecutive runs. Pure
 * and fully tested; the executor (reconcile.ts) applies the plan.
 */

import type {Finding} from '../findings/types.js';
import type {ExistingIssue} from '../issues/types.js';
import {findingHash} from './hash.js';
import {readMarker, readMisses} from './markers.js';
import {issueWasScanned, type ScanScope} from './scope.js';

/** Closing an issue with one of these labels means "do not refile". */
export const SUPPRESSION_LABELS = [
	'sentinel:false-positive',
	'sentinel:wontfix',
	'sentinel:accepted',
] as const;

/** Options for planning. */
export interface ReconcileOptions {
	/** Consecutive absent runs before an open issue is auto-resolved. Min 1. */
	resolveAfterMisses?: number;
	/**
	 * What this run actually read. Omit when every file was read — the planner
	 * then behaves exactly as it did before scope existed. Supplying a partial
	 * scope is what stops an unscanned finding being mistaken for a fixed one.
	 */
	scope?: ScanScope;
}

/** An open issue matched by a finding this run: reset its miss counter. */
export interface TouchOp {
	issue: ExistingIssue;
	finding: Finding;
}

/** An open issue absent this run but not yet stale: bump its miss counter. */
export interface MissOp {
	issue: ExistingIssue;
	misses: number;
}

/** What reconcile should do this run. */
export interface ReconcilePlan {
	/** Findings with no existing issue: file them. */
	toCreate: Finding[];
	/** Findings matching an open issue: touch it. */
	toTouch: TouchOp[];
	/** Findings matching a suppression-closed issue: skip. */
	suppressed: Finding[];
	/** Open issues absent long enough to auto-resolve. */
	toResolve: ExistingIssue[];
	/** Open issues absent this run but below the resolve threshold. */
	toIncrementMiss: MissOp[];
	/**
	 * Open issues whose file this run did not read. Absent from the findings, but
	 * that absence is not evidence of anything — so they are left untouched, with
	 * their miss counter exactly where it was. Reported rather than silent: "held,
	 * not scanned" and "still open" are different states and an operator needs to
	 * be able to tell them apart.
	 */
	held: ExistingIssue[];
}

function hasSuppressionLabel(issue: ExistingIssue): boolean {
	return issue.labels.some(label =>
		(SUPPRESSION_LABELS as readonly string[]).includes(label),
	);
}

/**
 * Every key an existing issue can be matched on: the hash it was filed with,
 * and the identity its own markers imply under the current scheme. An issue
 * filed by this version produces the same value twice; one filed by an older
 * version produces two different ones, and matching on either is correct.
 */
function identityKeysOf(issue: ExistingIssue): string[] {
	const keys = new Set<string>();
	const stored = readMarker(issue.body, 'hash');
	if (stored !== null) {
		keys.add(stored);
	}
	const path = readMarker(issue.body, 'path');
	if (path !== null) {
		keys.add(
			findingHash({
				pack: readMarker(issue.body, 'pack') ?? undefined,
				file: path,
			}),
		);
	}
	return [...keys];
}

/**
 * Plan the reconciliation of this run's findings against existing issues.
 */
export function planReconciliation(
	findings: Finding[],
	existing: ExistingIssue[],
	options: ReconcileOptions = {},
): ReconcilePlan {
	const resolveAfterMisses = Math.max(1, options.resolveAfterMisses ?? 3);

	// Deduplicate findings within this run by hash; first occurrence wins.
	const findingByHash = new Map<string, Finding>();
	for (const finding of findings) {
		const hash = findingHash(finding);
		if (!findingByHash.has(hash)) {
			findingByHash.set(hash, finding);
		}
	}

	// Index existing issues by their embedded hash, and also by the identity
	// recomputed from their own `pack` and `path` markers.
	//
	// The second key is what keeps an upgrade from looking like a mass refile.
	// An issue filed before the hash stopped including model-authored prose
	// carries a hash this version would never compute — but it carries the
	// markers the current identity is built from, so it can still be matched.
	// Both keys point at the same issue; whichever the run produces, it lands.
	const suppressedHashes = new Set<string>();
	const openByHash = new Map<string, ExistingIssue>();
	// The open issues themselves, each once. An issue can be reachable under
	// two keys, so ageing must walk this rather than the lookup map — iterating
	// the map would age a two-key issue twice in a single run, which is the
	// very failure this change exists to stop.
	const openIssues: ExistingIssue[] = [];
	for (const issue of existing) {
		const keys = identityKeysOf(issue);
		if (keys.length === 0) {
			continue;
		}
		if (hasSuppressionLabel(issue)) {
			for (const key of keys) {
				suppressedHashes.add(key);
			}
		} else if (issue.state === 'open') {
			for (const key of keys) {
				openByHash.set(key, issue);
			}
			openIssues.push(issue);
		}
	}

	const plan: ReconcilePlan = {
		toCreate: [],
		toTouch: [],
		suppressed: [],
		toResolve: [],
		toIncrementMiss: [],
		held: [],
	};

	for (const [hash, finding] of findingByHash) {
		if (suppressedHashes.has(hash)) {
			plan.suppressed.push(finding);
			continue;
		}
		const openIssue = openByHash.get(hash);
		if (openIssue) {
			plan.toTouch.push({issue: openIssue, finding});
		} else {
			plan.toCreate.push(finding);
		}
	}

	// Open issues whose finding did not recur this run: age them out — but only
	// where "did not recur" is something this run is in a position to claim.
	for (const issue of openIssues) {
		// Recurred under any of its identities, so it is still live.
		if (identityKeysOf(issue).some(key => findingByHash.has(key))) {
			continue;
		}
		if (
			!issueWasScanned(
				options.scope,
				readMarker(issue.body, 'pack'),
				readMarker(issue.body, 'path'),
			)
		) {
			plan.held.push(issue);
			continue;
		}
		const misses = readMisses(issue.body) + 1;
		if (misses >= resolveAfterMisses) {
			plan.toResolve.push(issue);
		} else {
			plan.toIncrementMiss.push({issue, misses});
		}
	}

	return plan;
}
