import test from 'ava';
import type {ReconcileResult} from '../dedup/reconcile.js';
import type {Finding} from '../findings/types.js';
import {countFindings, renderFilingLine, renderReport} from './report.js';
import type {PackOutcome, RunOutcome} from './types.js';

console.log('\nrun/report.spec.ts');

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'p/r',
		file: 'a.rs',
		lineRange: {start: 1, end: 3},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'x',
		summary: 'A bug',
		rationale: 'because',
		suggestedNextSteps: 'fix it',
		...overrides,
	};
}

function pack(overrides: Partial<PackOutcome> = {}): PackOutcome {
	return {
		pack: 'p',
		version: '1.0.0',
		findings: [finding()],
		attempts: 1,
		ok: true,
		errors: [],
		usage: {durationMs: 0, promptTokens: 0, outputTokens: 0},
		...overrides,
	};
}

function result(overrides: Partial<ReconcileResult> = {}): ReconcileResult {
	return {
		targetRepo: 'org/a',
		created: [],
		touched: 0,
		incremented: 0,
		resolved: 0,
		suppressed: 0,
		suppressedByOverride: 0,
		errors: [],
		...overrides,
	};
}

test('renders every filing counter in the per-repo line', t => {
	t.is(
		renderFilingLine(
			'myorg/myrepo',
			result({
				created: [
					{number: 1, url: 'u'},
					{number: 2, url: 'v'},
					{number: 3, url: 'w'},
				],
				touched: 5,
				incremented: 2,
				suppressed: 1,
			}),
		),
		'myorg/myrepo: filed 3, touched 5, aged 2, suppressed 1, suppressed-by-override 0, resolved 0',
	);
});

test('prints zeroed counters rather than omitting them', t => {
	t.is(
		renderFilingLine('org/a', result()),
		'org/a: filed 0, touched 0, aged 0, suppressed 0, suppressed-by-override 0, resolved 0',
	);
});

test('names the audited repo, not the issue target', t => {
	const line = renderFilingLine(
		'org/audited',
		result({targetRepo: 'org/central'}),
	);
	t.true(line.startsWith('org/audited: '));
	t.false(line.includes('org/central'));
});

test('the filing line omits tolerated errors', t => {
	const line = renderFilingLine('org/a', result({errors: ['create: boom']}));
	t.false(line.includes('boom'));
});

test('renders findings grouped by repo and pack', t => {
	const run: RunOutcome = {
		repos: [{repo: 'org/a', packs: [pack()], missingPacks: []}],
	};
	const md = renderReport(run);
	t.true(md.includes('# Sentinel audit report'));
	t.true(md.includes('1 finding(s) across 1 repository'));
	t.true(md.includes('## org/a'));
	t.true(md.includes('### Pack `p` (v1.0.0)'));
	t.true(md.includes('HIGH — A bug'));
	t.true(md.includes('**Why:** because'));
	t.true(md.includes('**Next:** fix it'));
});

test('countFindings totals across repos and packs', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [pack({findings: [finding(), finding()]})],
				missingPacks: [],
			},
			{repo: 'b', packs: [pack({findings: []})], missingPacks: []},
		],
	};
	t.is(countFindings(run), 2);
});

test('reports a clean pack as no findings', t => {
	const run: RunOutcome = {
		repos: [{repo: 'a', packs: [pack({findings: []})], missingPacks: []}],
	};
	t.true(renderReport(run).includes('No findings.'));
});

test('reports a run error', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [pack({ok: false, findings: [], runError: 'nanocoder missing'})],
				missingPacks: [],
			},
		],
	};
	t.true(renderReport(run).includes('Run error: nanocoder missing'));
});

test('reports validation failure after retries', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [
					pack({
						ok: false,
						findings: [],
						attempts: 2,
						errors: [{index: 0, field: 'severity', message: 'bad'}],
					}),
				],
				missingPacks: [],
			},
		],
	};
	t.true(renderReport(run).includes('malformed after 2 attempt'));
});

test('lists missing packs for a repo', t => {
	const run: RunOutcome = {
		repos: [{repo: 'a', packs: [], missingPacks: ['ghost']}],
	};
	t.true(
		renderReport(run).includes('Missing packs (not in rule-packs/): ghost'),
	);
});

test('handles a run with no repositories', t => {
	t.true(renderReport({repos: []}).includes('No repositories were audited.'));
});
