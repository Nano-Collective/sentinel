/**
 * Apply a rule pack's `severity_weighting` to the findings it produced.
 *
 * The manifest field was parsed, passed into the prompt, and then never checked
 * against what came back — so a pack declaring `sql-injection: critical` could
 * have the model emit `low` and that severity would be filed. The whole purpose
 * of per-pack weighting is to make severity authoritative rather than whatever
 * the model happened to choose, so the pack's word is law: a weighted rule's
 * severity is overwritten, not merely suggested.
 *
 * Overwriting rather than rejecting on mismatch (the alternative in #10) is
 * deliberate. A finding can be entirely accurate and still carry a severity the
 * model guessed; failing validation would discard real work and force a retry
 * that costs a model call to fix something we already know the right answer to.
 */

import type {RulePack} from '../rule-packs/types.js';
import type {Finding, Severity} from './types.js';

/** One severity the pack overrode, kept so the run can say what it changed. */
export interface SeverityOverride {
	rule: string;
	file: string;
	from: Severity;
	to: Severity;
}

/** Findings after weighting, plus what changed. */
export interface WeightedFindings {
	findings: Finding[];
	overrides: SeverityOverride[];
}

/**
 * Resolve a finding's rule against the weighting table.
 *
 * The reporting contract asks the model for `"<pack>/<pattern>"`, while a
 * manifest's weighting keys are the bare pattern names — so a literal lookup
 * matches nothing in the common case. Both spellings are accepted because a
 * pack author may reasonably write either, with the fully-qualified form
 * winning when both are present.
 */
function weightFor(
	rule: string,
	weighting: Record<string, Severity>,
): Severity | undefined {
	if (weighting[rule]) {
		return weighting[rule];
	}
	const slash = rule.lastIndexOf('/');
	if (slash === -1) {
		return undefined;
	}
	return weighting[rule.slice(slash + 1)];
}

/**
 * Overwrite each finding's severity where its rule is weighted by the pack.
 * Findings the pack says nothing about are returned untouched.
 */
export function applySeverityWeighting(
	findings: Finding[],
	pack: RulePack,
): WeightedFindings {
	const weighting = pack.manifest.severityWeighting;
	if (Object.keys(weighting).length === 0) {
		return {findings, overrides: []};
	}

	const overrides: SeverityOverride[] = [];
	const weighted = findings.map(finding => {
		const declared = weightFor(finding.rule, weighting);
		if (!declared || declared === finding.severity) {
			return finding;
		}
		overrides.push({
			rule: finding.rule,
			file: finding.file,
			from: finding.severity,
			to: declared,
		});
		return {...finding, severity: declared};
	});

	return {findings: weighted, overrides};
}
