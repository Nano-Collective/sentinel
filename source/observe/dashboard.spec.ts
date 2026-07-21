import test from 'ava';
import {renderDashboard} from './dashboard.js';
import type {RunRecord} from './types.js';

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
	const live = renderDashboard([
		record({filing: {filed: 5, touched: 0, resolved: 0}}),
	]);
	t.true(live.includes('>5</td>'));
	const dry = renderDashboard([record({mode: 'dry-run', filing: undefined})]);
	t.true(dry.includes('>—</td>'));
});

test('escapes HTML in record fields', t => {
	const html = renderDashboard([
		record({timestamp: '<script>alert(1)</script>'}),
	]);
	t.false(html.includes('<script>alert(1)</script>'));
	t.true(html.includes('&lt;script&gt;'));
});
