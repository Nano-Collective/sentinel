/**
 * Assemble the templated audit prompt for one rule pack against one repository.
 * The pack's Markdown body is the audit instructions; the source files (scoped
 * by the pack's applies_to globs) are the material; and a fixed reporting
 * contract tells the model to emit findings in the snake_case shape the
 * {@link ../findings/validate.js validator} accepts.
 */

import {CONFIDENCES, SEVERITIES} from '../findings/types.js';
import {matchesAppliesTo} from '../rule-packs/glob.js';
import type {PromptInput, PromptResult, SourceFile} from './types.js';

/** Prefix each line with a right-aligned 1-indexed number for line_range use. */
function numberLines(content: string): string {
	const lines = content.split('\n');
	const width = String(lines.length).length;
	return lines
		.map((line, i) => `${String(i + 1).padStart(width)}| ${line}`)
		.join('\n');
}

function formatFile(file: SourceFile): string {
	return [
		`===== FILE: ${file.path} =====`,
		numberLines(file.content),
		`===== END FILE: ${file.path} =====`,
	].join('\n');
}

function quotedList(values: readonly string[]): string {
	return values.map(value => `"${value}"`).join(', ');
}

function reportingContract(packName: string, category: string): string {
	return [
		'## Reporting findings',
		'',
		'Return ONLY a JSON array (no prose, no code fence) of findings. Return [] if you find nothing.',
		'Each finding is an object with exactly these keys:',
		'',
		`- "rule": string — the pack rule that fired, prefixed with the pack name (e.g. "${packName}/<pattern>")`,
		'- "file": string — the repository-relative path of the affected file',
		'- "line_range": object — {"start": <number>, "end": <number>}, 1-indexed and inclusive',
		`- "category": string — the finding category (e.g. "${category || packName}")`,
		`- "severity": string — one of ${quotedList(SEVERITIES)}`,
		`- "confidence": string — one of ${quotedList(CONFIDENCES)}`,
		'- "offending_snippet": string — the exact code the finding refers to',
		'',
		'Files below are shown with `N| ` line-number prefixes; use them for line_range.',
		'Do not include the prefix in offending_snippet.',
	].join('\n');
}

/**
 * Build an audit prompt. Files not matching the pack's applies_to scope are
 * excluded and reported back in {@link PromptResult.skippedFiles}.
 */
export function buildAuditPrompt(input: PromptInput): PromptResult {
	const {pack, files, repoName, context, repoNotes} = input;
	const {manifest, body} = pack;

	const included: SourceFile[] = [];
	const skippedFiles: string[] = [];
	for (const file of files) {
		if (matchesAppliesTo(manifest, file.path)) {
			included.push(file);
		} else {
			skippedFiles.push(file.path);
		}
	}

	const sections: string[] = [];

	const repoLabel = repoName ? `\`${repoName}\`` : 'this repository';
	const languages = manifest.appliesTo.languages;
	const framing = [
		'# Security audit',
		'',
		`You are a meticulous security reviewer auditing ${repoLabel} with the rule pack "${manifest.name}" (version ${manifest.version}, category ${manifest.category || 'unspecified'}).`,
		languages.length > 0 ? `The pack targets: ${languages.join(', ')}.` : '',
		'',
		'Follow the audit instructions exactly. Report only issues the instructions call for. When a pattern has known exceptions you cannot rule out from the code alone, lower your confidence rather than guessing.',
	]
		.filter(line => line !== '')
		.join('\n');
	sections.push(framing);

	sections.push(['## Audit instructions', '', body.trim()].join('\n'));

	const weighting = Object.entries(manifest.severityWeighting);
	if (weighting.length > 0) {
		sections.push(
			[
				'## Severity weighting',
				'',
				'The rule pack assigns these baseline severities to specific finding types:',
				'',
				...weighting.map(([key, severity]) => `- ${key}: ${severity}`),
			].join('\n'),
		);
	}

	sections.push(reportingContract(manifest.name, manifest.category));

	const contextParts: string[] = [];
	if (repoNotes && repoNotes.trim().length > 0) {
		contextParts.push(repoNotes.trim());
	}
	for (const file of context ?? []) {
		contextParts.push(formatFile(file));
	}
	if (contextParts.length > 0) {
		sections.push(
			['## Additional context', '', contextParts.join('\n\n')].join('\n'),
		);
	}

	sections.push(
		[
			'## Files under audit',
			'',
			included.length > 0
				? included.map(formatFile).join('\n\n')
				: "No files matched this pack's applies_to scope; report no findings.",
		].join('\n'),
	);

	return {
		prompt: sections.join('\n\n'),
		includedFiles: included.map(file => file.path),
		skippedFiles,
	};
}
