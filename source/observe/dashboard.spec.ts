import test from 'ava';
import {renderDashboard} from './dashboard.js';
import type {FilingSummary, RunRecord} from './types.js';

console.log('\nobserve/dashboard.spec.ts');

function record(overrides: Partial<RunRecord> = {}): RunRecord {
	return {
		timestamp: '2026-07-21T06:00:00.000Z',
		mode: 'live',
		repos: [],
		totals: {
			repos: 2,
			findings: 3,
			bySeverity: {low: 0, medium: 1, high: 1, critical: 1},
		},
		targetErrors: [],
		...overrides,
	};
}

function filing(overrides: Partial<FilingSummary> = {}): FilingSummary {
	return {
		filed: 0,
		touched: 0,
		incremented: 0,
		suppressed: 0,
		suppressedByOverride: 0,
		resolved: 0,
		...overrides,
	};
}

function numCells(html: string): string[] {
	return html
		.split('<td class="num">')
		.slice(1)
		.map(cell => cell.slice(0, cell.indexOf('</td>')));
}

test('renders a self-contained HTML page', t => {
	const html = renderDashboard([record()]);
	t.true(html.startsWith('<!doctype html>'));
	t.true(html.includes('<title>Sentinel</title>'));
	t.true(html.includes('2026-07-21T06:00:00.000Z'));
	t.true(html.includes('Latest run'));
});

test('orders runs newest first', t => {
	const html = renderDashboard([
		record({timestamp: '2026-07-01T00:00:00.000Z'}),
		record({timestamp: '2026-07-20T00:00:00.000Z'}),
	]);
	t.true(html.indexOf('2026-07-20') < html.indexOf('2026-07-01'));
	// The summary reflects the latest.
	t.true(html.includes('Latest run 2026-07-20T00:00:00.000Z'));
});

test('handles no records', t => {
	const html = renderDashboard([]);
	t.true(html.includes('No runs recorded yet.'));
});

test('shows the filed count for live runs and a dash otherwise', t => {
	const live = renderDashboard([record({filing: filing({filed: 5})})]);
	t.true(live.includes('>5</td>'));
	const dry = renderDashboard([record({mode: 'dry-run', filing: undefined})]);
	t.true(dry.includes('>—</td>'));
});

test('every row has one cell per column heading', t => {
	const html = renderDashboard([
		record({filing: filing({filed: 1})}),
		record({timestamp: '2026-07-20T00:00:00.000Z', mode: 'dry-run'}),
	]);
	const headings = html.split('<th>').length - 1;
	const rows = html
		.split('<tr>')
		.slice(1)
		.map(part => part.slice(0, part.indexOf('</tr>')))
		.filter(part => !part.includes('<th>'));
	t.is(rows.length, 2);
	for (const row of rows) {
		t.is(row.split('<td').length - 1, headings, row);
	}
});

test('heads a column for every filing counter', t => {
	const html = renderDashboard([record()]);
	for (const label of [
		'Filed',
		'Touched',
		'Aged',
		'Suppressed',
		'By override',
		'Resolved',
	]) {
		t.true(html.includes(`<th>${label}</th>`), label);
	}
});

test('renders every filing counter for a live run', t => {
	const html = renderDashboard([
		record({
			filing: filing({
				filed: 1,
				touched: 2,
				incremented: 3,
				suppressed: 4,
				suppressedByOverride: 5,
				resolved: 6,
			}),
		}),
	]);
	const cells = numCells(html);
	t.deepEqual(cells.slice(-7, -1), ['1', '2', '3', '4', '5', '6']);
});

test('a zeroed counter renders as 0, not as a dash or a dot', t => {
	const html = renderDashboard([record({filing: filing({filed: 7})})]);
	const cells = numCells(html);
	t.deepEqual(cells.slice(-7, -1), ['7', '0', '0', '0', '0', '0']);
});

test('every filing column dashes out on a run that filed nothing', t => {
	const html = renderDashboard([record({mode: 'dry-run', filing: undefined})]);
	const cells = numCells(html);
	t.deepEqual(cells.slice(-7, -1), ['—', '—', '—', '—', '—', '—']);
});

test('a record written before the new counters existed dashes them out', t => {
	// Records committed by alpha.0-alpha.3 carry only {filed, touched, resolved}
	// and there is no migration on the read path: writeDashboard JSON.parses
	// straight into a RunRecord. The cast is a lie at the JSON boundary, so the
	// three new cells must fall back rather than render "undefined".
	const legacy = {filed: 5, touched: 0, resolved: 0} as FilingSummary;
	const html = renderDashboard([record({filing: legacy})]);
	t.false(html.includes('undefined'));
	t.deepEqual(numCells(html).slice(-7, -1), ['5', '0', '—', '—', '—', '0']);

	// Same shape with non-zero survivors, so a fallback that swallowed every
	// cell (or a 0/undefined mix-up) cannot pass the assertion above.
	const busy = {filed: 5, touched: 2, resolved: 1} as FilingSummary;
	const busyHtml = renderDashboard([record({filing: busy})]);
	t.false(busyHtml.includes('undefined'));
	t.deepEqual(numCells(busyHtml).slice(-7, -1), ['5', '2', '—', '—', '—', '1']);
});

test('the table can scroll horizontally on a narrow viewport', t => {
	const html = renderDashboard([record()]);
	t.true(html.includes('overflow-x: auto'));
	t.true(html.includes('<div class="scroll">'));
});

test('escapes HTML in record fields', t => {
	const html = renderDashboard([
		record({timestamp: '<script>alert(1)</script>'}),
	]);
	t.false(html.includes('<script>alert(1)</script>'));
	t.true(html.includes('&lt;script&gt;'));
});

// --- problems ---------------------------------------------------------------

test('a clean run shows no problem banner', t => {
	const html = renderDashboard([record()]);
	t.false(html.includes('did not complete'));
});

test('a run where every target failed does not read as a clean estate', t => {
	// The bug this guards: targetErrors was persisted on every run record and
	// rendered by nothing, so a run in which all repos failed to clone showed
	// "0 finding(s) across 0 repo(s)" in the same calm grey as a clean estate.
	const html = renderDashboard([
		record({
			totals: {
				repos: 0,
				findings: 0,
				bySeverity: {low: 0, medium: 0, high: 0, critical: 0},
			},
			targetErrors: [
				'could not check out my-org/a: no access',
				'could not check out my-org/b: no access',
			],
		}),
	]);
	t.true(html.includes('did not complete'));
	t.true(html.includes('a low count here does not mean a clean estate'));
	t.true(html.includes('my-org/a'));
	t.true(html.includes('my-org/b'));
});

test('rule packs that failed to load appear in the banner', t => {
	const html = renderDashboard([
		record({packLoadErrors: ['broken.md — name: missing']}),
	]);
	t.true(html.includes('did not complete'));
	t.true(html.includes('broken.md'));
});

test('the banner reflects the latest run, not an older one', t => {
	const html = renderDashboard([
		record({timestamp: '2026-07-22T06:00:00.000Z'}),
		record({timestamp: '2026-07-21T06:00:00.000Z', targetErrors: ['old fail']}),
	]);
	t.false(html.includes('did not complete'));
	t.false(html.includes('old fail'));
});

test('the problems column counts every channel', t => {
	const html = renderDashboard([
		record({
			targetErrors: ['a', 'b'],
			packLoadErrors: ['c'],
		}),
	]);
	t.true(html.includes('<td class="num problems">3</td>'));
});

test('a run with no problems shows a dot in the problems column', t => {
	const html = renderDashboard([record()]);
	t.true(html.trimEnd().includes('<td class="num">·</td>'));
});

test('problem text is HTML-escaped in the banner', t => {
	const html = renderDashboard([
		record({targetErrors: ['<script>alert(1)</script>']}),
	]);
	t.false(html.includes('<script>alert(1)</script>'));
	t.true(html.includes('&lt;script&gt;'));
});

test('a record written before packLoadErrors existed still renders', t => {
	const older = record();
	delete older.packLoadErrors;
	const html = renderDashboard([older]);
	t.true(html.includes('<!doctype html>'));
	t.false(html.includes('did not complete'));
});

test('the dashboard surfaces packs that re-read everything', t => {
	const html = renderDashboard([
		record({
			repos: [
				{
					repo: 'org/a',
					findings: 0,
					bySeverity: {low: 0, medium: 0, high: 0, critical: 0},
					packs: [],
					fullPasses: ['db-safety — the cached commit is unreachable'],
				},
			],
		}),
	]);
	t.true(html.includes('re-read every file'));
	t.true(html.includes('db-safety'));
});

test('a run with no full passes gets no notice', t => {
	t.false(renderDashboard([record()]).includes('re-read every file'));
});
