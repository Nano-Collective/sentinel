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
import {renderPackSelectionProblems} from './report.js';
import type {UnresolvedPack} from './types.js';

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
	/**
	 * Open issues a live run would leave alone because it did not read their
	 * file. Zero whenever the run read everything.
	 */
	wouldHold: number;
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
		wouldHold: plan.held.length,
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

/** A pack whose audit did not produce valid findings this run. */
export interface PackFailure {
	pack: string;
	reason: string;
}

/** One repo's dry-run preview, plus any packs that did not produce findings. */
export interface PreviewEntry {
	repo: string;
	preview: DryRunPreview;
	failedPacks: PackFailure[];
	/** Packs named by the target but missing from the rule-packs directory. */
	missingPacks: string[];
	/** Packs present on disk whose `depends_on` chain failed to resolve. */
	unresolvedPacks: UnresolvedPack[];
}

function failureBlock(failedPacks: PackFailure[]): string {
	if (failedPacks.length === 0) {
		return '';
	}
	// Failed audits produce no findings, so the groups above understate the
	// picture — surface them explicitly rather than reading as "clean".
	return [
		'',
		`> ⚠️ ${failedPacks.length} pack(s) failed to audit (findings above are incomplete):`,
		...failedPacks.map(failure => `> - \`${failure.pack}\`: ${failure.reason}`),
	].join('\n');
}

/** Render the dry-run previews for every repo as Markdown. */
export function renderPreview(previews: PreviewEntry[]): string {
	const parts = ['# Sentinel dry run', '', 'No issues were filed.'];

	for (const {
		repo,
		preview,
		failedPacks,
		missingPacks,
		unresolvedPacks,
	} of previews) {
		const packProblems = renderPackSelectionProblems(
			missingPacks,
			unresolvedPacks,
		);
		parts.push(
			[
				`## ${repo}`,
				'',
				...(packProblems.length > 0 ? [packProblems.join('\n'), ''] : []),
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
				...(preview.wouldHold > 0
					? [
							'',
							`**Would hold:** ${preview.wouldHold} open issue(s) whose file this run did not read — neither refreshed nor aged`,
						]
					: []),
				failureBlock(failedPacks),
			].join('\n'),
		);
	}

	return parts.join('\n\n');
}
