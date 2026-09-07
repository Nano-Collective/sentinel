/**
 * Render a self-contained static HTML dashboard from the committed run records.
 * No database, no build step, no external assets — a single page suitable for
 * the config repo's GitHub Pages. Pure and tested.
 */

import type {FilingSummary, RunRecord} from './types.js';

const MAX_ROWS = 60;

const FILING_COLUMNS: readonly (readonly [string, keyof FilingSummary])[] = [
	['Filed', 'filed'],
	['Touched', 'touched'],
	['Aged', 'incremented'],
	['Suppressed', 'suppressed'],
	['By override', 'suppressedByOverride'],
	['Resolved', 'resolved'],
] as const;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function severityCell(count: number, className: string): string {
	const shown = count > 0 ? String(count) : '·';
	return `<td class="sev ${className}">${shown}</td>`;
}

function filingCell(
	filing: FilingSummary | undefined,
	key: keyof FilingSummary,
): string {
	return `<td class="num">${filing?.[key] ?? '—'}</td>`;
}

/** Every problem one record carries, as flat display lines. */
function problemsOf(record: RunRecord): string[] {
	return [...(record.packLoadErrors ?? []), ...record.targetErrors];
}

/**
 * Packs that re-read everything on a target that asked for incremental
 * scanning. Not a problem — the audit was complete, which is the safe outcome —
 * but the operator's only durable signal that the setting they enabled is not
 * doing anything, so it is shown rather than left to an expired step summary.
 */
function fullPassesOf(record: RunRecord): string[] {
	return record.repos.flatMap(repo =>
		(repo.fullPasses ?? []).map(note => `${repo.repo}: ${note}`),
	);
}

function problemCell(record: RunRecord): string {
	const count = problemsOf(record).length;
	return count > 0
		? `<td class="num problems">${count}</td>`
		: '<td class="num">·</td>';
}

function row(record: RunRecord): string {
	const {bySeverity} = record.totals;
	return [
		'<tr>',
		`<td class="ts">${escapeHtml(record.timestamp)}</td>`,
		`<td><span class="mode ${record.mode}">${record.mode}</span></td>`,
		`<td class="num">${record.totals.repos}</td>`,
		`<td class="num">${record.totals.findings}</td>`,
		severityCell(bySeverity.critical, 'critical'),
		severityCell(bySeverity.high, 'high'),
		severityCell(bySeverity.medium, 'medium'),
		severityCell(bySeverity.low, 'low'),
		...FILING_COLUMNS.map(([, key]) => filingCell(record.filing, key)),
		problemCell(record),
		'</tr>',
	].join('');
}

/**
 * The banner above the table when the most recent run did not complete.
 *
 * Without it a run in which every repository failed to clone renders as
 * "0 finding(s) across 0 repo(s)" in the same calm grey as a genuinely clean
 * estate. The dashboard is the read surface an operator trusts, so a partial
 * audit has to look different from a clean one at a glance.
 */
function problemBanner(latest: RunRecord | undefined): string {
	if (!latest) {
		return '';
	}
	const problems = problemsOf(latest);
	if (problems.length === 0) {
		return '';
	}
	return `<div class="alert">
<strong>⚠️ The latest run did not complete.</strong> Its findings are incomplete — a low count here does not mean a clean estate.
<ul>${problems.map(problem => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>
</div>`;
}

/** Render the dashboard HTML for a set of run records (newest first). */
export function renderDashboard(records: RunRecord[]): string {
	const sorted = [...records].sort((a, b) =>
		b.timestamp.localeCompare(a.timestamp),
	);
	const latest = sorted[0];
	const rows = sorted.slice(0, MAX_ROWS).map(row).join('\n');

	const summary = latest
		? `Latest run ${escapeHtml(latest.timestamp)} — ${latest.totals.findings} finding(s) across ${latest.totals.repos} repo(s).`
		: 'No runs recorded yet.';
	const banner = problemBanner(latest);
	const fullPasses = latest ? fullPassesOf(latest) : [];
	const fullPassNotice =
		fullPasses.length === 0
			? ''
			: `<div class="notice">
<strong>Incremental scanning: ${fullPasses.length} pack pass(es) re-read every file.</strong> The audit was complete — this is the safe outcome — but the setting is not saving anything for these.
<ul>${fullPasses.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
</div>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentinel</title>
<style>
:root { color-scheme: dark; }
body { font-family: system-ui, sans-serif; background: #1a1b26; color: #a9b1d6; margin: 0; padding: 2rem; }
h1 { color: #7aa2f7; margin: 0 0 .25rem; font-size: 1.4rem; }
p.summary { color: #c0caf5; margin: 0 0 1.5rem; }
div.scroll { overflow-x: auto; }
div.notice { background: #232433; border-left: 3px solid #7dcfff; padding: .75rem 1rem; margin: 0 0 1.5rem; border-radius: 4px; color: #c0caf5; }
div.notice ul { margin: .5rem 0 0; padding-left: 1.2rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { padding: .5rem .6rem; text-align: left; white-space: nowrap; border-bottom: 1px solid #292e42; }
th { color: #565f89; font-weight: 600; text-transform: uppercase; font-size: .72rem; letter-spacing: .04em; }
td.num, td.sev { text-align: right; font-variant-numeric: tabular-nums; }
.ts { color: #9aa5ce; font-variant-numeric: tabular-nums; }
.mode { padding: .1rem .45rem; border-radius: 999px; font-size: .72rem; }
.mode.live { background: #2d3b2d; color: #9ece6a; }
.mode.dry-run { background: #3b352d; color: #e0af68; }
.mode.audit-only { background: #2d3242; color: #7dcfff; }
.sev.critical { color: #f7768e; }
.sev.high { color: #ff9e64; }
.sev.medium { color: #e0af68; }
.sev.low { color: #565f89; }
td.problems { color: #f7768e; font-weight: 600; }
div.alert { background: #33242a; border: 1px solid #f7768e; border-radius: .4rem; padding: .8rem 1rem; margin: 0 0 1.5rem; color: #f7768e; }
div.alert ul { margin: .5rem 0 0; padding-left: 1.2rem; color: #c0caf5; }
footer { margin-top: 1.5rem; color: #565f89; font-size: .8rem; }
</style>
</head>
<body>
<h1>🛡️ Sentinel</h1>
<p class="summary">${summary}</p>
${banner}${fullPassNotice}
<div class="scroll">
<table>
<thead><tr>
<th>Run</th><th>Mode</th><th>Repos</th><th>Findings</th>
<th>Crit</th><th>High</th><th>Med</th><th>Low</th>
${FILING_COLUMNS.map(([label]) => `<th>${label}</th>`).join('')}
<th>Problems</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<footer>Generated by <a href="https://docs.nanocollective.org/sentinel/docs" style="color:#7aa2f7">Sentinel</a> from committed run records.</footer>
</body>
</html>
`;
}
