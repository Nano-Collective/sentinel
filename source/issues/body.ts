/**
 * Build the title and Markdown body of an issue from a finding. Pure and
 * heavily tested — this is the human-facing surface of the whole tool, so it
 * degrades gracefully when the optional model-authored fields are absent.
 */

import type {Finding} from '../findings/types.js';
import type {FilingContext} from './types.js';

const TITLE_HEADLINE_MAX = 80;

function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** A code fence longer than any backtick run in the snippet, so it can't break. */
function fenceFor(snippet: string): string {
	const longestRun = Math.max(
		0,
		...[...snippet.matchAll(/`+/g)].map(match => match[0].length),
	);
	return '`'.repeat(Math.max(3, longestRun + 1));
}

/** A concise, scannable issue title. */
export function buildIssueTitle(finding: Finding): string {
	const headline = truncate(
		finding.summary ?? finding.rule,
		TITLE_HEADLINE_MAX,
	);
	return `Sentinel [${finding.severity}] ${headline} (${finding.file}:${finding.lineRange.start})`;
}

/** The full issue body. */
export function buildIssueBody(
	finding: Finding,
	context: FilingContext,
): string {
	const {file, lineRange, rule, severity, confidence, category} = finding;
	const parts: string[] = [];

	parts.push(
		finding.summary ?? `A ${category} finding produced by rule \`${rule}\`.`,
	);

	parts.push(
		[
			`**Severity:** ${severity} · **Confidence:** ${confidence} · **Category:** ${category}`,
			`**Location:** \`${file}\` lines ${lineRange.start}–${lineRange.end}`,
			`**Rule:** \`${rule}\`${context.packVersion ? ` (pack ${context.packVersion})` : ''}`,
		].join('\n'),
	);

	if (finding.rationale) {
		parts.push(['### Why this severity', '', finding.rationale].join('\n'));
	}

	const fence = fenceFor(finding.offendingSnippet);
	parts.push(
		[
			'### Offending code',
			`${fence}`,
			finding.offendingSnippet,
			`${fence}`,
		].join('\n'),
	);

	if (finding.suggestedNextSteps) {
		parts.push(
			['### Suggested next steps', '', finding.suggestedNextSteps].join('\n'),
		);
	}

	const configLink = context.configRepo
		? ` Configured in [\`${context.configRepo}\`](https://github.com/${context.configRepo}).`
		: '';
	parts.push(
		[
			'---',
			`🛡️ Filed by Sentinel.${configLink} If this is a false positive, close this issue as \`sentinel:false-positive\` (or add that label) and Sentinel will not refile it.`,
		].join('\n'),
	);

	return parts.join('\n\n');
}
