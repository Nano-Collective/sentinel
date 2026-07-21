import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import {findingHash} from '../dedup/hash.js';
import {upsertMarker} from '../dedup/markers.js';
import type {Finding, Severity} from '../findings/types.js';
import type {ExistingIssue} from '../issues/types.js';
import {previewReconciliation, renderPreview} from './preview.js';

console.log('\nrun/preview.spec.ts');

function config(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
	return {
		targets: [{repo: 'my-org/a', rulePacks: ['p']}],
		schedule: '0 6 * * *',
		severityThreshold: 'medium',
		model: {provider: 'ollama', model: 'llama3.1'},
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: false},
		...overrides,
	};
}

function finding(file: string, severity: Severity = 'high'): Finding {
	return {
		rule: 'p/r',
		file,
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity,
		confidence: 'medium',
		offendingSnippet: 'x',
	};
}

function openIssueFor(f: Finding): ExistingIssue {
	return {
		number: 1,
		url: 'u',
		state: 'open',
		labels: ['sentinel'],
		body: upsertMarker('body', 'hash', findingHash(f)),
	};
}

test('groups a brand-new finding under would-file-as-new', t => {
	const preview = previewReconciliation([finding('a.ts')], config(), []);
	t.is(preview.wouldFileAsNew.length, 1);
	t.is(preview.dedupWouldMatch.length, 0);
	t.is(preview.belowThreshold.length, 0);
});

test('groups a finding with an existing issue under dedup-would-match', t => {
	const f = finding('a.ts');
	const preview = previewReconciliation([f], config(), [openIssueFor(f)]);
	t.is(preview.wouldFileAsNew.length, 0);
	t.is(preview.dedupWouldMatch.length, 1);
});

test('groups a low finding under below-threshold', t => {
	const preview = previewReconciliation(
		[finding('a.ts', 'low')],
		config({severityThreshold: 'medium'}),
		[],
	);
	t.is(preview.belowThreshold.length, 1);
	t.is(preview.wouldFileAsNew.length, 0);
});

test('counts findings suppressed by a per-repo override', t => {
	const preview = previewReconciliation([finding('gen/a.ts')], config(), [], {
		suppress: [{paths: ['gen/**'], reason: 'generated'}],
	});
	t.is(preview.suppressedByOverride.length, 1);
	t.is(preview.wouldFileAsNew.length, 0);
});

test('mutates nothing (the existing issues array is untouched)', t => {
	const f = finding('a.ts');
	const existing = [openIssueFor(f)];
	const snapshot = JSON.stringify(existing);
	previewReconciliation([f], config(), existing);
	t.is(JSON.stringify(existing), snapshot);
});

test('renderPreview lists each group with counts', t => {
	const preview = previewReconciliation(
		[finding('a.ts'), finding('b.ts', 'low')],
		config(),
		[],
	);
	const md = renderPreview([{repo: 'my-org/a', preview}]);
	t.true(md.includes('# Sentinel dry run'));
	t.true(md.includes('No issues were filed.'));
	t.true(md.includes('## my-org/a'));
	t.true(md.includes('Would file as new** (1)'));
	t.true(md.includes('Below severity threshold** (1)'));
	t.true(md.includes('Dedup would have matched:** none'));
});
