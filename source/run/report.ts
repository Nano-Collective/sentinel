/**
 * Render a run's outcome as Markdown — the local `--output` file and the
 * Actions step summary. Pure and tested.
 */

import {findingHash} from '../dedup/hash.js';
import type {Finding} from '../findings/types.js';
import type {PackOutcome, RepoOutcome, RunOutcome} from './types.js';

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
	return [header, '', ...outcome.findings.map(findingSection)].join('\n\n');
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

function repoSection(outcome: RepoOutcome): string {
	const parts = [`## ${outcome.repo}`];
	if (outcome.missingPacks.length > 0) {
		parts.push(
			`> Missing packs (not in rule-packs/): ${outcome.missingPacks.join(', ')}`,
		);
	}
	for (const pack of outcome.packs) {
		parts.push(packSection(pack));
	}
	return parts.join('\n\n');
}

/** Count the findings across a run. */
export function countFindings(run: RunOutcome): number {
	return run.repos.reduce(
		(total, repo) =>
			total + repo.packs.reduce((sum, pack) => sum + pack.findings.length, 0),
		0,
	);
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
