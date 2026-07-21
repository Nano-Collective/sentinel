import test from 'ava';
import type {Finding} from '../findings/types.js';
import type {ExistingIssue} from '../issues/types.js';
import {findingHash} from './hash.js';
import {upsertMarker} from './markers.js';
import {planReconciliation} from './plan.js';

console.log('\ndedup/plan.spec.ts');

function finding(file: string): Finding {
	return {
		rule: 'p/r',
		file,
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'x',
	};
}

/** An existing issue carrying the hash of the given finding. */
function issueFor(
	f: Finding,
	overrides: Partial<ExistingIssue> = {},
): ExistingIssue {
	return {
		number: 1,
		url: 'u',
		state: 'open',
		labels: ['sentinel'],
		body: upsertMarker('body', 'hash', findingHash(f)),
		...overrides,
	};
}

test('files a finding with no existing issue', t => {
	const f = finding('a.rs');
	const plan = planReconciliation([f], []);
	t.deepEqual(plan.toCreate, [f]);
	t.is(plan.toTouch.length, 0);
});

test('touches an open issue matching the finding instead of refiling', t => {
	const f = finding('a.rs');
	const plan = planReconciliation([f], [issueFor(f)]);
	t.is(plan.toCreate.length, 0);
	t.is(plan.toTouch.length, 1);
	t.is(plan.toTouch[0]?.finding.file, 'a.rs');
});

test('suppresses a finding matching a false-positive-closed issue', t => {
	const f = finding('a.rs');
	const suppressed = issueFor(f, {
		state: 'closed',
		labels: ['sentinel', 'sentinel:false-positive'],
	});
	const plan = planReconciliation([f], [suppressed]);
	t.is(plan.toCreate.length, 0);
	t.deepEqual(plan.suppressed, [f]);
});

test('suppression also covers wontfix and accepted closes', t => {
	const f1 = finding('a.rs');
	const f2 = finding('b.rs');
	const existing = [
		issueFor(f1, {state: 'closed', labels: ['sentinel:wontfix']}),
		issueFor(f2, {state: 'closed', labels: ['sentinel:accepted']}),
	];
	const plan = planReconciliation([f1, f2], existing);
	t.is(plan.suppressed.length, 2);
	t.is(plan.toCreate.length, 0);
});

test('deduplicates identical findings within a single run', t => {
	const f = finding('a.rs');
	const plan = planReconciliation([f, {...f}], []);
	t.is(plan.toCreate.length, 1);
});

test('increments the miss counter for an absent open issue', t => {
	const gone = finding('gone.rs');
	const plan = planReconciliation([], [issueFor(gone)]);
	t.is(plan.toIncrementMiss.length, 1);
	t.is(plan.toIncrementMiss[0]?.misses, 1);
	t.is(plan.toResolve.length, 0);
});

test('resolves an open issue once it reaches the miss threshold', t => {
	const gone = finding('gone.rs');
	const issue = issueFor(gone, {
		body: upsertMarker(
			upsertMarker('body', 'hash', findingHash(gone)),
			'misses',
			'2',
		),
	});
	const plan = planReconciliation([], [issue], {resolveAfterMisses: 3});
	t.is(plan.toResolve.length, 1);
	t.is(plan.toIncrementMiss.length, 0);
});

test('a recurring finding resets rather than resolving', t => {
	const f = finding('a.rs');
	const issue = issueFor(f, {
		body: upsertMarker(
			upsertMarker('body', 'hash', findingHash(f)),
			'misses',
			'2',
		),
	});
	const plan = planReconciliation([f], [issue], {resolveAfterMisses: 3});
	t.is(plan.toTouch.length, 1);
	t.is(plan.toResolve.length, 0);
	t.is(plan.toIncrementMiss.length, 0);
});

test('ignores existing issues with no hash marker', t => {
	const f = finding('a.rs');
	const plan = planReconciliation(
		[f],
		[
			{
				number: 9,
				url: 'u',
				state: 'open',
				labels: ['sentinel'],
				body: 'no marker',
			},
		],
	);
	t.deepEqual(plan.toCreate, [f]);
	t.is(plan.toIncrementMiss.length, 0);
});
