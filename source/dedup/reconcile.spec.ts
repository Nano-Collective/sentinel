import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import type {Finding, Severity} from '../findings/types.js';
import type {
	CreatedIssue,
	CreateIssueParams,
	ExistingIssue,
	LabelFailure,
	ReconcileClient,
} from '../issues/types.js';
import {findingHash} from './hash.js';
import {readMarker, readMisses, upsertMarker} from './markers.js';
import {reconcileFindings} from './reconcile.js';

console.log('\ndedup/reconcile.spec.ts');

const NOW = '2026-07-21T06:00:00.000Z';

function config(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
	return {
		targets: [{repo: 'my-org/my-program', rulePacks: ['p']}],
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

interface Update {
	number: number;
	body: string;
}
interface Close {
	number: number;
	reason?: string;
}

/** A full client that records every mutation and serves canned existing issues. */
function fakeClient(existing: ExistingIssue[] = []) {
	const created: CreateIssueParams[] = [];
	const updated: Update[] = [];
	const closed: Close[] = [];
	const labelled: string[] = [];
	const client: ReconcileClient = {
		async ensureLabels({labels}): Promise<LabelFailure[]> {
			labelled.push(...labels);
			return [];
		},
		async createIssue(params): Promise<CreatedIssue> {
			created.push(params);
			return {number: 100 + created.length, url: 'u'};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return existing;
		},
		async updateIssue({number, body}): Promise<void> {
			updated.push({number, body});
		},
		async closeIssue({number, reason}): Promise<void> {
			closed.push({number, reason});
		},
	};
	return {client, created, updated, closed, labelled};
}

function openIssueFor(
	f: Finding,
	number: number,
	misses?: number,
): ExistingIssue {
	let body = upsertMarker('body', 'hash', findingHash(f));
	if (misses !== undefined) {
		body = upsertMarker(body, 'misses', String(misses));
	}
	return {number, url: 'u', state: 'open', labels: ['sentinel'], body};
}

const CTX = {auditedRepo: 'my-org/my-program', configRepo: 'my-org/config'};

test('ensures Sentinel labels exist before filing', async t => {
	const {client, labelled} = fakeClient();
	await reconcileFindings([finding('a.rs')], config(), client, CTX, NOW);
	t.true(labelled.includes('sentinel'));
	t.true(labelled.includes('sentinel:false-positive'));
});

test('records a filing error and keeps going', async t => {
	const client = {
		async ensureLabels(): Promise<LabelFailure[]> {
			return [];
		},
		async createIssue(): Promise<never> {
			throw new Error("label 'sentinel' not found");
		},
		async listIssues(): Promise<never[]> {
			return [];
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};
	const result = await reconcileFindings(
		[finding('a.rs')],
		config(),
		client,
		CTX,
		NOW,
	);
	t.is(result.created.length, 0);
	t.is(result.errors.length, 1);
	t.true(result.errors[0]?.includes('not found'));
});

test('files a new finding with tracking markers set', async t => {
	const {client, created} = fakeClient();
	const result = await reconcileFindings(
		[finding('a.rs')],
		config(),
		client,
		CTX,
		NOW,
	);
	t.is(result.created.length, 1);
	t.is(created.length, 1);
	t.is(
		readMarker(created[0]?.body ?? '', 'hash'),
		findingHash(finding('a.rs')),
	);
	t.is(readMisses(created[0]?.body ?? ''), 0);
	t.is(readMarker(created[0]?.body ?? '', 'last-seen'), NOW);
});

test('does not refile a finding that already has an open issue', async t => {
	const f = finding('a.rs');
	const {client, created, updated} = fakeClient([openIssueFor(f, 7)]);
	const result = await reconcileFindings([f], config(), client, CTX, NOW);
	t.is(created.length, 0);
	t.is(result.touched, 1);
	t.is(updated[0]?.number, 7);
	t.is(readMisses(updated[0]?.body ?? ''), 0);
});

test('filters out below-threshold findings before planning', async t => {
	const {client, created} = fakeClient();
	const result = await reconcileFindings(
		[finding('low.rs', 'low')],
		config({severityThreshold: 'medium'}),
		client,
		CTX,
		NOW,
	);
	t.is(created.length, 0);
	t.is(result.created.length, 0);
	// Below-threshold is not suppression — it must not inflate either counter,
	// which the run summary reports as suppression doing work.
	t.is(result.suppressed, 0);
	t.is(result.suppressedByOverride, 0);
});

test('increments the miss counter for an absent finding', async t => {
	const gone = finding('gone.rs');
	const {client, updated} = fakeClient([openIssueFor(gone, 8, 0)]);
	const result = await reconcileFindings([], config(), client, CTX, NOW);
	t.is(result.incremented, 1);
	t.is(readMisses(updated[0]?.body ?? ''), 1);
});

test('auto-resolves an issue that has missed enough runs', async t => {
	const gone = finding('gone.rs');
	const {client, closed} = fakeClient([openIssueFor(gone, 9, 2)]);
	const result = await reconcileFindings([], config(), client, CTX, NOW, {
		resolveAfterMisses: 3,
	});
	t.is(result.resolved, 1);
	t.is(closed[0]?.number, 9);
	t.is(closed[0]?.reason, 'completed');
});

test('a per-repo suppression removes a finding before filing', async t => {
	const {client, created} = fakeClient();
	const override = {
		suppress: [{paths: ['gen/**'], reason: 'generated code'}],
	};
	const result = await reconcileFindings(
		[finding('gen/out.rs'), finding('src/main.rs')],
		config(),
		client,
		CTX,
		NOW,
		{},
		override,
	);
	t.is(created.length, 1);
	t.is(created[0]?.repo, 'my-org/my-program');
	t.is(result.suppressedByOverride, 1);
	// The non-suppressed finding was filed.
	t.is(result.created.length, 1);
});

test('a per-repo threshold override changes what qualifies', async t => {
	const {client, created} = fakeClient();
	const override = {severityThreshold: 'critical' as const, suppress: []};
	const result = await reconcileFindings(
		[finding('a.rs', 'high')],
		config({severityThreshold: 'medium'}),
		client,
		CTX,
		NOW,
		{},
		override,
	);
	// high no longer qualifies under a per-repo critical threshold.
	t.is(created.length, 0);
	t.is(result.created.length, 0);
});

test('routes to the config repo when aggregating', async t => {
	const {client, created} = fakeClient();
	const cfg = config({
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: true},
	});
	const result = await reconcileFindings(
		[finding('a.rs')],
		cfg,
		client,
		CTX,
		NOW,
	);
	t.is(result.targetRepo, 'my-org/config');
	t.is(created[0]?.repo, 'my-org/config');
});

test('a label that could not be created is reported, not swallowed', async t => {
	// The bug: ensureLabels discarded the gh CLI's result entirely, so a run
	// that could not create its labels filed issues without them — silently
	// breaking dedup and suppression — and said nothing.
	const client: ReconcileClient = {
		async ensureLabels({labels}): Promise<LabelFailure[]> {
			return labels.map(label => ({
				label,
				error: 'gh label create failed (status 1): forbidden',
			}));
		},
		async createIssue(params): Promise<CreatedIssue> {
			return {number: 1, url: `u/${params.repo}`};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return [];
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};

	const result = await reconcileFindings(
		[finding('a.rs')],
		config(),
		client,
		CTX,
		NOW,
	);

	// Best effort is preserved: the run continued and still filed.
	t.is(result.created.length, 1);
	// But every failure is now on the record.
	t.is(result.errors.length, 4);
	t.true(result.errors.every(error => error.startsWith('ensure label "')));
	t.true(result.errors.some(error => error.includes('sentinel')));
	t.true(result.errors.some(error => error.includes('forbidden')));
});

test('a throwing ensureLabels is tolerated and recorded once', async t => {
	const client: ReconcileClient = {
		async ensureLabels(): Promise<LabelFailure[]> {
			throw new Error('gh is not on PATH');
		},
		async createIssue(): Promise<CreatedIssue> {
			return {number: 1, url: 'u'};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return [];
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};
	const result = await reconcileFindings(
		[finding('a.rs')],
		config(),
		client,
		CTX,
		NOW,
	);
	t.is(result.created.length, 1);
	t.is(result.errors.length, 1);
	t.true(result.errors[0]?.includes('gh is not on PATH'));
});

test('no label failures leaves the error list clean', async t => {
	const {client} = fakeClient();
	const result = await reconcileFindings(
		[finding('a.rs')],
		config(),
		client,
		CTX,
		NOW,
	);
	t.deepEqual(result.errors, []);
});

test('a filed issue carries the path marker', async t => {
	const {client, created} = fakeClient();
	const f = finding('src/db.rs');
	await reconcileFindings([f], config(), client, CTX, NOW);
	t.is(readMarker(created[0]?.body ?? '', 'path'), 'src/db.rs');
});

test('a filed issue carries the pack marker when the pack is known', async t => {
	const {client, created} = fakeClient();
	const f = finding('src/db.rs');
	await reconcileFindings([f], config(), client, CTX, NOW, {
		packOfFinding: new Map([[f, 'db-safety']]),
	});
	t.is(readMarker(created[0]?.body ?? '', 'pack'), 'db-safety');
});

test('an unattributable finding files without a pack marker', async t => {
	// Safe direction: no marker means a later partial run holds the issue rather
	// than ageing it out on the strength of a scan it cannot vouch for.
	const {client, created} = fakeClient();
	await reconcileFindings([finding('a.rs')], config(), client, CTX, NOW, {
		packOfFinding: new Map(),
	});
	t.is(readMarker(created[0]?.body ?? '', 'pack'), null);
});

test('touching an issue backfills the scope markers', async t => {
	// This is the migration. Issues filed before the markers existed get them
	// the next time their finding recurs — and because the first run after an
	// upgrade reads everything, that happens before any file is ever skipped.
	const f = finding('src/db.rs');
	const legacy = openIssueFor(f, 7);
	t.is(readMarker(legacy.body, 'path'), null, 'starts unmarked');

	const {client, updated} = fakeClient([legacy]);
	await reconcileFindings([f], config(), client, CTX, NOW, {
		packOfFinding: new Map([[f, 'db-safety']]),
	});

	t.is(updated.length, 1);
	t.is(readMarker(updated[0]?.body ?? '', 'path'), 'src/db.rs');
	t.is(readMarker(updated[0]?.body ?? '', 'pack'), 'db-safety');
	t.is(readMisses(updated[0]?.body ?? ''), 0, 'still resets the counter');
});

test('a held issue is neither updated nor closed', async t => {
	const gone = finding('unscanned.rs');
	let body = upsertMarker('body', 'hash', findingHash(gone));
	body = upsertMarker(upsertMarker(body, 'pack', 'p'), 'path', 'unscanned.rs');
	body = upsertMarker(body, 'misses', '2');
	const issue: ExistingIssue = {
		number: 9,
		url: 'u',
		state: 'open',
		labels: ['sentinel'],
		body,
	};

	const {client, updated, closed} = fakeClient([issue]);
	const result = await reconcileFindings([], config(), client, CTX, NOW, {
		resolveAfterMisses: 3,
		scope: {
			scannedByPack: new Map([['p', new Set(['other.rs'])]]),
			fullPacks: new Set(),
		},
	});

	t.is(result.held, 1);
	t.is(result.incremented, 0);
	t.is(result.resolved, 0);
	t.deepEqual(updated, [], 'the body is left exactly as it was');
	t.deepEqual(closed, [], 'and nothing is closed');
});
