/**
 * The third suppression layer: the opt-in per-repo `sentinel.yaml` override
 * (see docs/findings/index.md#suppression). It can lower or raise the filing
 * threshold for one repo and declare systematic-noise exemptions matched by
 * rule and/or path glob. The content-hash floor and the label layer live in the
 * dedup planner; this is the escape hatch layered on top.
 */

import type {
	RepoOverride,
	SentinelConfig,
	Suppression,
} from '../config/types.js';
import type {Finding, Severity} from '../findings/types.js';
import {matchesGlob} from '../rule-packs/glob.js';

/**
 * A finding matches a suppression when its rule matches (if the suppression
 * names one) and its file matches (if the suppression lists paths). Rule and
 * path patterns are globs, so `solana-anchor/*` or `programs/vault/**` work.
 */
export function matchesSuppression(
	finding: Finding,
	suppression: Suppression,
): boolean {
	const hasRule = suppression.rule !== undefined && suppression.rule.length > 0;
	const hasPaths = suppression.paths.length > 0;
	// Defensive: a suppression with neither clause never matches anything.
	if (!hasRule && !hasPaths) {
		return false;
	}
	const ruleMatches = hasRule
		? matchesGlob(suppression.rule as string, finding.rule)
		: true;
	const pathMatches = hasPaths
		? suppression.paths.some(pattern => matchesGlob(pattern, finding.file))
		: true;
	return ruleMatches && pathMatches;
}

/** True if any of the override's suppressions match the finding. */
export function isSuppressed(
	finding: Finding,
	override: RepoOverride,
): boolean {
	return override.suppress.some(suppression =>
		matchesSuppression(finding, suppression),
	);
}

/** The effect of applying a per-repo override to a run's findings. */
export interface OverrideOutcome {
	/** Findings that survive the override, in input order. */
	kept: Finding[];
	/** Findings removed by a suppression rule. */
	suppressed: Finding[];
	/** The threshold to file at: the override's, or the org default. */
	threshold: Severity;
}

/**
 * Apply a per-repo override to a run's findings: partition out the suppressed
 * ones and resolve the effective severity threshold. With no override, every
 * finding is kept and the org threshold stands.
 */
export function applyRepoOverride(
	findings: Finding[],
	config: SentinelConfig,
	override?: RepoOverride,
): OverrideOutcome {
	const threshold = override?.severityThreshold ?? config.severityThreshold;
	if (!override || override.suppress.length === 0) {
		return {kept: findings, suppressed: [], threshold};
	}

	const kept: Finding[] = [];
	const suppressed: Finding[] = [];
	for (const finding of findings) {
		if (isSuppressed(finding, override)) {
			suppressed.push(finding);
		} else {
			kept.push(finding);
		}
	}
	return {kept, suppressed, threshold};
}
