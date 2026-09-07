/**
 * Render a run's outcome as Markdown — the local `--output` file and the
 * Actions step summary. Pure and tested.
 */

import {findingHash} from '../dedup/hash.js';
import type {ReconcileResult} from '../dedup/reconcile.js';
import type {Finding} from '../findings/types.js';
import type {SeverityOverride} from '../findings/weighting.js';
import type {
	PackLoadError,
	PackOutcome,
	RepoOutcome,
	RunOutcome,
	UnresolvedPack,
} from './types.js';

function findingSection(finding: Finding): string {
	const lines = [
		`#### ${finding.severity.toUpperCase()} — ${finding.summary ?? finding.rule}`,
		'',
		`- **File:** \`${finding.file}\` lines ${finding.lineRange.start}–${finding.lineRange.end}`,
		`- **Rule:** \`${finding.rule}\` · **Confidence:** ${finding.confidence} · **Category:** ${finding.category}`,
		`- **Hash:** \`${findingHash(finding)}\``,
	];
	if (finding.rationale) {
		lines.push(`- **Why:** ${finding.rationale}`);
	}
	if (finding.suggestedNextSteps) {
		lines.push(`- **Next:** ${finding.suggestedNextSteps}`);
	}
	return lines.join('\n');
}

function packSection(outcome: PackOutcome): string {
	const header = `### Pack \`${outcome.pack}\` (v${outcome.version})`;
	if (outcome.runError) {
		return `${header}\n\n> Run error: ${outcome.runError}${rawBlock(outcome.raw)}`;
	}
	if (!outcome.ok) {
		const detail = outcome.errors
			.map(error => `${error.field}: ${error.message}`)
			.join('; ');
		return `${header}\n\n> Findings were malformed after ${outcome.attempts} attempt(s): ${detail}${rawBlock(outcome.raw)}`;
	}
	if (outcome.findings.length === 0) {
		return `${header}\n\nNo findings.`;
	}
	return [
		header,
		'',
		...severityOverrideNote(outcome.severityOverrides),
		...outcome.findings.map(findingSection),
	].join('\n\n');
}

/**
 * Severities the pack rewrote. Shown because the rewrite is a real change to
 * what gets filed and to how it is triaged — a pack author calibrating
 * `severity_weighting` needs to see it firing, and an operator reading a
 * `critical` needs to know whether the model or the pack said so.
 */
function severityOverrideNote(overrides: SeverityOverride[]): string[] {
	if (overrides.length === 0) {
		return [];
	}
	return [
		[
			`> The pack's severity weighting overrode ${overrides.length} severity(ies):`,
			...overrides.map(
				o => `> - \`${o.rule}\` in \`${o.file}\`: ${o.from} → ${o.to}`,
			),
		].join('\n'),
	];
}

/** A collapsible block with the raw model output, for diagnosing a failure. */
function rawBlock(raw: string | undefined): string {
	if (!raw) {
		return '';
	}
	const capped =
		raw.length > 6000 ? `${raw.slice(0, 6000)}\n…(truncated)` : raw;
	return `\n\n<details><summary>Raw model output</summary>\n\n\`\`\`\n${capped}\n\`\`\`\n</details>`;
}

/**
 * The two ways a named pack can fail to run, rendered apart. A pack with a
 * broken `depends_on` graph used to be reported as "not in rule-packs/", which
 * is false — it is on disk — and sent the reader hunting for a file rather than
 * at the dependency error that actually stopped it.
 */
export function renderPackSelectionProblems(
	missingPacks: string[],
	unresolvedPacks: UnresolvedPack[],
): string[] {
	const parts: string[] = [];
	if (missingPacks.length > 0) {
		parts.push(
			`> ⚠️ Missing packs (not in rule-packs/): ${missingPacks.join(', ')}`,
		);
	}
	for (const {pack, errors} of unresolvedPacks) {
		const detail = errors
			.map(error => `${error.field}: ${error.message}`)
			.join('; ');
		parts.push(
			`> ⚠️ Pack \`${pack}\` is in rule-packs/ but its depends_on chain did not resolve, so it did not run — ${detail}`,
		);
	}
	return parts;
}

function repoSection(outcome: RepoOutcome): string {
	const parts = [
		`## ${outcome.repo}`,
		...renderPackSelectionProblems(
			outcome.missingPacks,
			outcome.unresolvedPacks,
		),
	];
	for (const pack of outcome.packs) {
		parts.push(packSection(pack));
	}
	return parts.join('\n\n');
}

/** The per-repo filing line a live run prints for each reconciled repo. */
export function renderFilingLine(
	repo: string,
	result: ReconcileResult,
): string {
	return [
		`${repo}: filed ${result.created.length}`,
		`touched ${result.touched}`,
		`aged ${result.incremented}`,
		`suppressed ${result.suppressed}`,
		`suppressed-by-override ${result.suppressedByOverride}`,
		`resolved ${result.resolved}`,
	].join(', ');
}

/** Count the findings across a run. */
export function countFindings(run: RunOutcome): number {
	return run.repos.reduce(
		(total, repo) =>
			total + repo.packs.reduce((sum, pack) => sum + pack.findings.length, 0),
		0,
	);
}

/**
 * Run-level things that went wrong, as opposed to per-repo findings. These are
 * the reasons a report can be short without the estate being clean.
 */
export interface RunProblems {
	/** Rule packs that failed to parse, so never ran against anything. */
	packLoadErrors: PackLoadError[];
	/** Target-expansion and clone failures: repos that were never audited. */
	targetErrors: string[];
	/** Label creation failures, per repo, tolerated during filing. */
	filingErrors: {repo: string; errors: string[]}[];
}

/** True if nothing went wrong, so the caller can omit the section entirely. */
export function hasRunProblems(problems: RunProblems): boolean {
	return (
		problems.packLoadErrors.length > 0 ||
		problems.targetErrors.length > 0 ||
		problems.filingErrors.some(entry => entry.errors.length > 0)
	);
}

/**
 * Render the run-level problems as a Markdown section, or `''` when there are
 * none. Appended to whichever report a run produced — full or dry-run preview —
 * so no output path can present a partial audit as a complete one.
 */
export function renderRunProblems(problems: RunProblems): string {
	if (!hasRunProblems(problems)) {
		return '';
	}

	const lines = [
		'## ⚠️ Problems',
		'',
		'This run did not complete cleanly. The findings above are incomplete.',
		'',
	];

	if (problems.packLoadErrors.length > 0) {
		lines.push(
			`**Rule packs that failed to load (${problems.packLoadErrors.length}):**`,
		);
		for (const {file, errors} of problems.packLoadErrors) {
			const detail =
				errors.length > 0
					? errors.map(error => `${error.field}: ${error.message}`).join('; ')
					: 'could not be parsed';
			lines.push(`- \`${file}\` — ${detail}`);
		}
		lines.push('');
	}

	if (problems.targetErrors.length > 0) {
		lines.push(
			`**Targets that could not be audited (${problems.targetErrors.length}):**`,
		);
		for (const error of problems.targetErrors) {
			lines.push(`- ${error}`);
		}
		lines.push('');
	}

	for (const {repo, errors} of problems.filingErrors) {
		if (errors.length === 0) {
			continue;
		}
		lines.push(`**Filing problems on \`${repo}\` (${errors.length}):**`);
		for (const error of errors) {
			lines.push(`- ${error}`);
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}

/** Render a full run as a Markdown report. */
export function renderReport(run: RunOutcome): string {
	const total = countFindings(run);
	const header = [
		'# Sentinel audit report',
		'',
		`${total} finding(s) across ${run.repos.length} repository(ies).`,
	].join('\n');

	if (run.repos.length === 0) {
		return `${header}\n\nNo repositories were audited.`;
	}

	return [header, ...run.repos.map(repoSection)].join('\n\n');
}
