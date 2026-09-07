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
	const md = renderPreview([
		{
			repo: 'my-org/a',
			preview,
			failedPacks: [],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.true(md.includes('# Sentinel dry run'));
	t.true(md.includes('No issues were filed.'));
	t.true(md.includes('## my-org/a'));
	t.true(md.includes('Would file as new** (1)'));
	t.true(md.includes('Below severity threshold** (1)'));
	t.true(md.includes('Dedup would have matched:** none'));
});

test('renderPreview surfaces failed packs instead of masking them as clean', t => {
	const preview = previewReconciliation([], config(), []);
	const md = renderPreview([
		{
			repo: 'my-org/a',
			preview,
			failedPacks: [{pack: 'p', reason: 'malformed output after 2 attempt(s)'}],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.true(md.includes('failed to audit'));
	t.true(md.includes('`p`'));
	t.true(md.includes('malformed output'));
});

test('renderPreview shows no failure block when all packs succeeded', t => {
	const preview = previewReconciliation([], config(), []);
	const md = renderPreview([
		{
			repo: 'my-org/a',
			preview,
			failedPacks: [],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.false(md.includes('failed to audit'));
});

test('a dry run does not present an unrun pack as clean', t => {
	// Every group reads "none" when no pack ran. Without the pack-selection
	// problems travelling with the preview, a repo whose packs never ran looks
	// identical to one audited and found clean.
	const preview = previewReconciliation([], config(), []);
	const md = renderPreview([
		{
			repo: 'my-org/a',
			preview,
			failedPacks: [],
			missingPacks: ['ghost'],
			unresolvedPacks: [
				{pack: 'app', errors: [{field: 'depends_on', message: 'cycle'}]},
			],
		},
	]);
	t.true(md.includes('Missing packs (not in rule-packs/): ghost'));
	t.true(md.includes('depends_on chain did not resolve'));
	t.true(md.includes('`app`'));
});

test('a dry run with no pack problems shows no pack warnings', t => {
	const preview = previewReconciliation([], config(), []);
	const md = renderPreview([
		{
			repo: 'my-org/a',
			preview,
			failedPacks: [],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.false(md.includes('Missing packs'));
	t.false(md.includes('did not resolve'));
});

test('a dry run reports what it would hold', t => {
	const gone = finding('unscanned.rs');
	let body = upsertMarker('body', 'hash', findingHash(gone));
	body = upsertMarker(upsertMarker(body, 'pack', 'p'), 'path', 'unscanned.rs');
	const preview = previewReconciliation(
		[],
		config(),
		[{number: 1, url: 'u', state: 'open', labels: ['sentinel'], body}],
		undefined,
		{
			scope: {
				scannedByPack: new Map([['p', new Set(['other.rs'])]]),
				fullPacks: new Set(),
			},
		},
	);
	t.is(preview.wouldHold, 1);
	t.is(preview.wouldResolve, 0);
});

test('renderPreview stays silent about holds when there are none', t => {
	// A line reading "would hold: 0" on every complete run is noise, and noise
	// is what stops the interesting case being noticed.
	const markdown = renderPreview([
		{
			repo: 'org/a',
			preview: {
				wouldFileAsNew: [],
				dedupWouldMatch: [],
				belowThreshold: [],
				suppressedByOverride: [],
				suppressedByLabel: [],
				wouldResolve: 0,
				wouldHold: 0,
			},
			failedPacks: [],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.false(markdown.includes('Would hold'));
});

test('renderPreview surfaces holds when there are some', t => {
	const markdown = renderPreview([
		{
			repo: 'org/a',
			preview: {
				wouldFileAsNew: [],
				dedupWouldMatch: [],
				belowThreshold: [],
				suppressedByOverride: [],
				suppressedByLabel: [],
				wouldResolve: 0,
				wouldHold: 3,
			},
			failedPacks: [],
			missingPacks: [],
			unresolvedPacks: [],
		},
	]);
	t.true(markdown.includes('Would hold:** 3'));
});
