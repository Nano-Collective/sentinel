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
	t.deepEqual(cells.slice(-6), ['1', '2', '3', '4', '5', '6']);
});

test('a zeroed counter renders as 0, not as a dash or a dot', t => {
	const html = renderDashboard([record({filing: filing({filed: 7})})]);
	const cells = numCells(html);
	t.deepEqual(cells.slice(-6), ['7', '0', '0', '0', '0', '0']);
});

test('every filing column dashes out on a run that filed nothing', t => {
	const html = renderDashboard([record({mode: 'dry-run', filing: undefined})]);
	const cells = numCells(html);
	t.deepEqual(cells.slice(-6), ['—', '—', '—', '—', '—', '—']);
});

test('escapes HTML in record fields', t => {
	const html = renderDashboard([
		record({timestamp: '<script>alert(1)</script>'}),
	]);
	t.false(html.includes('<script>alert(1)</script>'));
	t.true(html.includes('&lt;script&gt;'));
});
