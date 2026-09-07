import test from 'ava';
import type {Finding} from '../findings/types.js';
import type {ExistingIssue} from '../issues/types.js';
import {findingHash} from './hash.js';
import {readMisses, upsertMarker} from './markers.js';
import {planReconciliation} from './plan.js';
import {fullScope} from './scope.js';

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

test('an open issue carrying a suppression label still suppresses', t => {
	// hasSuppressionLabel is checked ahead of the state === 'open' branch, so
	// the label is what counts, not the close. The run summary's `suppressed`
	// counter and the calibration guidance in docs/findings/index.md both
	// depend on this, so pin it: a wontfix nobody closed must not read as a
	// touch.
	const f = finding('a.rs');
	const plan = planReconciliation(
		[f],
		[issueFor(f, {state: 'open', labels: ['sentinel', 'sentinel:wontfix']})],
	);
	t.deepEqual(plan.suppressed, [f]);
	t.is(plan.toTouch.length, 0);
	t.is(plan.toCreate.length, 0);
	// It is suppressed, not aged — an absent-but-suppressed issue must not
	// drift toward auto-resolution.
	t.is(plan.toIncrementMiss.length, 0);
	t.is(plan.toResolve.length, 0);
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

/** An issue carrying the hash plus the scope markers a current run writes. */
function markedIssueFor(
	f: Finding,
	pack: string,
	overrides: Partial<ExistingIssue> = {},
): ExistingIssue {
	const base = issueFor(f, overrides);
	return {
		...base,
		body: upsertMarker(upsertMarker(base.body, 'pack', pack), 'path', f.file),
	};
}

test('with no scope, an absent finding ages out exactly as before', t => {
	const gone = finding('gone.rs');
	const plan = planReconciliation([], [markedIssueFor(gone, 'p')]);
	t.is(plan.toIncrementMiss.length, 1);
	t.is(plan.held.length, 0);
});

test('a full scope changes nothing about ageing', t => {
	const gone = finding('gone.rs');
	const plan = planReconciliation([], [markedIssueFor(gone, 'p')], {
		scope: fullScope(['p']),
	});
	t.is(plan.toIncrementMiss.length, 1);
	t.is(plan.held.length, 0);
});

test('an issue whose file was not read is held, not aged', t => {
	const gone = finding('unscanned.rs');
	const plan = planReconciliation([], [markedIssueFor(gone, 'p')], {
		scope: {
			scannedByPack: new Map([['p', new Set(['other.rs'])]]),
			fullPacks: new Set(),
		},
	});
	t.is(plan.held.length, 1, 'held');
	t.is(plan.toIncrementMiss.length, 0, 'not aged');
	t.is(plan.toResolve.length, 0, 'not resolved');
});

test('a held issue is not resolved even when already at the threshold', t => {
	// The dangerous case: an issue one miss away from being auto-closed, whose
	// file this run did not read. Ageing it here closes a real finding.
	const gone = finding('unscanned.rs');
	const issue = markedIssueFor(gone, 'p');
	const plan = planReconciliation(
		[],
		[{...issue, body: upsertMarker(issue.body, 'misses', '2')}],
		{
			resolveAfterMisses: 3,
			scope: {
				scannedByPack: new Map([['p', new Set(['other.rs'])]]),
				fullPacks: new Set(),
			},
		},
	);
	t.is(plan.toResolve.length, 0);
	t.is(plan.held.length, 1);
});

test('an issue whose file WAS read still ages out under a partial scope', t => {
	// Holding must be narrow. A finding that genuinely stopped recurring in a
	// file the run did read has to keep closing itself, or auto-resolution is
	// dead the moment incremental scanning is switched on.
	const gone = finding('scanned.rs');
	const plan = planReconciliation([], [markedIssueFor(gone, 'p')], {
		scope: {
			scannedByPack: new Map([['p', new Set(['scanned.rs'])]]),
			fullPacks: new Set(),
		},
	});
	t.is(plan.toIncrementMiss.length, 1);
	t.is(plan.held.length, 0);
});

test('holding survives repeated runs — the acceptance property', t => {
	// Reconciliation across several incremental runs in which the file is never
	// read. Without the scope the miss counter reaches the threshold and the
	// issue is closed; with it, the counter never moves at all.
	const gone = finding('unscanned.rs');
	let issue = markedIssueFor(gone, 'p');
	const scope = {
		scannedByPack: new Map([['p', new Set(['other.rs'])]]),
		fullPacks: new Set<string>(),
	};

	for (let run = 0; run < 5; run++) {
		const plan = planReconciliation([], [issue], {
			resolveAfterMisses: 3,
			scope,
		});
		t.is(plan.toResolve.length, 0, `run ${run}: not resolved`);
		t.is(plan.held.length, 1, `run ${run}: held`);
		// A held issue is not rewritten, so its body carries into the next run
		// unchanged — including its miss counter.
		for (const {issue: aged, misses} of plan.toIncrementMiss) {
			issue = {
				...aged,
				body: upsertMarker(aged.body, 'misses', String(misses)),
			};
		}
	}

	t.is(readMisses(issue.body), 0, 'the miss counter never moved');
});
