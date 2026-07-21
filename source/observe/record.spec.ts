import test from 'ava';
import type {Finding} from '../findings/types.js';
import type {RunReport} from '../run/run.js';
import type {PackOutcome, RepoOutcome} from '../run/types.js';
import {buildRunRecord, recordFilename} from './record.js';

console.log('\nobserve/record.spec.ts');

const TS = '2026-07-21T06:00:00.000Z';

function finding(severity: Finding['severity']): Finding {
	return {
		rule: 'p/r',
		file: 'a.ts',
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity,
		confidence: 'high',
		offendingSnippet: 'x',
	};
}

function pack(findings: Finding[]): PackOutcome {
	return {
		pack: 'p',
		version: '1.0.0',
		findings,
		attempts: 1,
		ok: true,
		errors: [],
	};
}

function repo(name: string, packs: PackOutcome[]): RepoOutcome {
	return {repo: name, packs, missingPacks: []};
}

function report(overrides: Partial<RunReport> = {}): RunReport {
	return {
		outcome: {repos: []},
		reconciled: [],
		previews: [],
		packLoadErrors: [],
		targetErrors: [],
		filed: false,
		...overrides,
	};
}

test('counts findings by severity per repo and in totals', t => {
	const r = report({
		outcome: {
			repos: [
				repo('org/a', [pack([finding('critical'), finding('high')])]),
				repo('org/b', [pack([finding('high'), finding('low')])]),
			],
		},
	});
	const record = buildRunRecord(r, TS, 'audit-only');
	t.is(record.totals.repos, 2);
	t.is(record.totals.findings, 4);
	t.deepEqual(record.totals.bySeverity, {
		low: 1,
		medium: 0,
		high: 2,
		critical: 1,
	});
	t.is(record.repos[0]?.bySeverity.critical, 1);
	t.is(record.repos[0]?.packs[0]?.findings, 2);
});

test('records the timestamp and mode', t => {
	const record = buildRunRecord(report(), TS, 'dry-run');
	t.is(record.timestamp, TS);
	t.is(record.mode, 'dry-run');
	t.is(record.filing, undefined);
});

test('includes a filing summary on a live run', t => {
	const r = report({
		filed: true,
		reconciled: [
			{
				repo: 'org/a',
				result: {
					targetRepo: 'org/a',
					created: [{number: 1, url: 'u'}],
					touched: 2,
					incremented: 0,
					resolved: 1,
					suppressed: 0,
					suppressedByOverride: 0,
				},
			},
		],
	});
	const record = buildRunRecord(r, TS, 'live');
	t.deepEqual(record.filing, {filed: 1, touched: 2, resolved: 1});
});

test('carries target errors', t => {
	const record = buildRunRecord(
		report({targetErrors: ['boom']}),
		TS,
		'audit-only',
	);
	t.deepEqual(record.targetErrors, ['boom']);
});

test('recordFilename is filesystem-safe', t => {
	t.is(recordFilename(TS), '2026-07-21T06-00-00-000Z.json');
	t.false(recordFilename(TS).includes(':'));
});
