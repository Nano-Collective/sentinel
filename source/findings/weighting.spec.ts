import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import type {Finding, Severity} from './types.js';
import {applySeverityWeighting} from './weighting.js';

console.log('\nfindings/weighting.spec.ts');

function pack(severityWeighting: Record<string, Severity> = {}): RulePack {
	return {
		manifest: {
			name: 'db-safety',
			version: '1.0.0',
			description: '',
			appliesTo: {paths: ['**/*.ts'], languages: ['typescript']},
			severityWeighting,
			dependsOn: [],
			category: 'security',
		},
		body: 'Flag bugs.',
	};
}

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'db-safety/sql-injection',
		file: 'src/db.ts',
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity: 'low',
		confidence: 'medium',
		offendingSnippet: 'query(userInput)',
		...overrides,
	};
}

test('a pack with no weighting leaves everything alone', t => {
	const input = [finding(), finding({rule: 'db-safety/other'})];
	const result = applySeverityWeighting(input, pack());
	t.is(result.findings, input, 'returns the same array, not a copy');
	t.deepEqual(result.overrides, []);
});

test('a weighted rule has its severity overwritten', t => {
	// The bug: the model emitted `low` for a rule the pack calls critical, and
	// that severity was filed. Weighting existed and was ignored.
	const result = applySeverityWeighting(
		[finding({severity: 'low'})],
		pack({'sql-injection': 'critical'}),
	);
	t.is(result.findings[0]?.severity, 'critical');
});

test('the override is reported, not applied silently', t => {
	const result = applySeverityWeighting(
		[finding({severity: 'low'})],
		pack({'sql-injection': 'critical'}),
	);
	t.deepEqual(result.overrides, [
		{
			rule: 'db-safety/sql-injection',
			file: 'src/db.ts',
			from: 'low',
			to: 'critical',
		},
	]);
});

test('a bare pattern key matches the prefixed rule the model emits', t => {
	// The reporting contract asks for "<pack>/<pattern>", while manifests are
	// written with bare pattern names. A literal lookup matches nothing, which
	// is how this feature could look implemented and do nothing.
	const result = applySeverityWeighting(
		[finding({rule: 'db-safety/sql-injection', severity: 'medium'})],
		pack({'sql-injection': 'critical'}),
	);
	t.is(result.findings[0]?.severity, 'critical');
});

test('a fully-qualified key also matches', t => {
	const result = applySeverityWeighting(
		[finding({severity: 'medium'})],
		pack({'db-safety/sql-injection': 'high'}),
	);
	t.is(result.findings[0]?.severity, 'high');
});

test('a fully-qualified key wins over a bare one', t => {
	const result = applySeverityWeighting(
		[finding({severity: 'low'})],
		pack({
			'sql-injection': 'medium',
			'db-safety/sql-injection': 'critical',
		}),
	);
	t.is(result.findings[0]?.severity, 'critical');
});

test('an unweighted rule keeps the severity the model chose', t => {
	const result = applySeverityWeighting(
		[finding({rule: 'db-safety/unbounded-query', severity: 'high'})],
		pack({'sql-injection': 'critical'}),
	);
	t.is(result.findings[0]?.severity, 'high');
	t.deepEqual(result.overrides, []);
});

test('a severity that already agrees is not reported as an override', t => {
	// Otherwise the run summary would claim the pack corrected something it
	// did not, and the count would be meaningless.
	const result = applySeverityWeighting(
		[finding({severity: 'critical'})],
		pack({'sql-injection': 'critical'}),
	);
	t.is(result.findings[0]?.severity, 'critical');
	t.deepEqual(result.overrides, []);
});

test('weighting can lower a severity as well as raise it', t => {
	// The pack is authoritative in both directions — a model inflating
	// everything to critical is as much a triage problem as one deflating it.
	const result = applySeverityWeighting(
		[finding({severity: 'critical'})],
		pack({'sql-injection': 'low'}),
	);
	t.is(result.findings[0]?.severity, 'low');
	t.is(result.overrides[0]?.from, 'critical');
	t.is(result.overrides[0]?.to, 'low');
});

test('a rule with no pack prefix still matches a bare key', t => {
	const result = applySeverityWeighting(
		[finding({rule: 'sql-injection', severity: 'low'})],
		pack({'sql-injection': 'critical'}),
	);
	t.is(result.findings[0]?.severity, 'critical');
});

test('only the weighted findings are rewritten', t => {
	const result = applySeverityWeighting(
		[
			finding({rule: 'db-safety/sql-injection', severity: 'low'}),
			finding({rule: 'db-safety/unbounded-query', severity: 'high'}),
			finding({rule: 'db-safety/sql-injection', file: 'src/b.ts'}),
		],
		pack({'sql-injection': 'critical'}),
	);
	t.deepEqual(
		result.findings.map(f => f.severity),
		['critical', 'high', 'critical'],
	);
	t.is(result.overrides.length, 2);
	t.deepEqual(
		result.overrides.map(o => o.file),
		['src/db.ts', 'src/b.ts'],
		'each override names its own file, so two hits are distinguishable',
	);
});

test('the original findings are not mutated', t => {
	// The caller may still hold the array — rewriting in place would change
	// what a dry-run preview reported after the fact.
	const original = finding({severity: 'low'});
	applySeverityWeighting([original], pack({'sql-injection': 'critical'}));
	t.is(original.severity, 'low');
});

test('every other field survives the rewrite', t => {
	const original = finding({
		severity: 'low',
		rationale: 'because',
		suggestedNextSteps: 'fix it',
		summary: 'A bug',
	});
	const result = applySeverityWeighting(
		[original],
		pack({'sql-injection': 'critical'}),
	);
	t.deepEqual(
		{...result.findings[0], severity: 'low'},
		original,
		'only severity should differ',
	);
});
