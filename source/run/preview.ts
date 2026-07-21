/**
 * Dry-run preview. Computes what a live run *would* do — without mutating
 * anything — by running the same override, threshold, and dedup planning
 * read-only, then grouping the findings into the buckets the whitepaper calls
 * for: would file as new, dedup would have matched, below severity threshold
 * (see docs/workflow/index.md#run-modes).
 */

import type {RepoOverride, SentinelConfig} from '../config/types.js';
import {planReconciliation, type ReconcileOptions} from '../dedup/plan.js';
import {type Finding, meetsSeverityThreshold} from '../findings/types.js';
import type {ExistingIssue} from '../issues/types.js';
import {applyRepoOverride} from '../suppression/apply.js';

/** The grouped outcome a live run would produce. */
export interface DryRunPreview {
	/** Findings with no existing issue: a live run would file these. */
	wouldFileAsNew: Finding[];
	/** Findings matching an existing open issue: dedup would touch, not refile. */
	dedupWouldMatch: Finding[];
	/** Findings below the effective threshold: never filed. */
	belowThreshold: Finding[];
	/** Findings removed by the per-repo override's suppress rules. */
	suppressedByOverride: Finding[];
	/** Findings matching a dismissed (false-positive/wontfix/accepted) issue. */
	suppressedByLabel: Finding[];
	/** Open issues a live run would auto-resolve as stale. */
	wouldResolve: number;
}

/** Compute the dry-run preview for one repo's findings. */
export function previewReconciliation(
	findings: Finding[],
	config: SentinelConfig,
	existing: ExistingIssue[],
	override?: RepoOverride,
	options: ReconcileOptions = {},
): DryRunPreview {
	const {
		kept,
		suppressed: suppressedByOverride,
		threshold,
	} = applyRepoOverride(findings, config, override);

	const belowThreshold: Finding[] = [];
	const qualifying: Finding[] = [];
	for (const finding of kept) {
		if (meetsSeverityThreshold(finding.severity, threshold)) {
			qualifying.push(finding);
		} else {
			belowThreshold.push(finding);
		}
	}

	const plan = planReconciliation(qualifying, existing, options);

	return {
		wouldFileAsNew: plan.toCreate,
		dedupWouldMatch: plan.toTouch.map(op => op.finding),
		belowThreshold,
		suppressedByOverride,
		suppressedByLabel: plan.suppressed,
		wouldResolve: plan.toResolve.length,
	};
}

function findingLine(finding: Finding): string {
	return `- **${finding.severity}** ${finding.summary ?? finding.rule} — \`${finding.file}\`:${finding.lineRange.start}`;
}

function group(title: string, findings: Finding[]): string {
	if (findings.length === 0) {
		return `**${title}:** none`;
	}
	return [
		`**${title}** (${findings.length}):`,
		...findings.map(findingLine),
	].join('\n');
}

/** Render the dry-run previews for every repo as Markdown. */
export function renderPreview(
	previews: {repo: string; preview: DryRunPreview}[],
): string {
	const parts = ['# Sentinel dry run', '', 'No issues were filed.'];

	for (const {repo, preview} of previews) {
		parts.push(
			[
				`## ${repo}`,
				'',
				group('Would file as new', preview.wouldFileAsNew),
				'',
				group('Dedup would have matched', preview.dedupWouldMatch),
				'',
				group('Below severity threshold', preview.belowThreshold),
				'',
				group('Suppressed by per-repo override', preview.suppressedByOverride),
				'',
				group('Suppressed by a prior dismissal', preview.suppressedByLabel),
				'',
				`**Would auto-resolve:** ${preview.wouldResolve} stale issue(s)`,
			].join('\n'),
		);
	}

	return parts.join('\n\n');
}
