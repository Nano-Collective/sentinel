import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import {
	type DecideInput,
	decidePackScope,
	dependencyHash,
	explainFullReason,
	type GitProbe,
	packBodyHash,
} from './decide.js';
import type {PackCacheEntry} from './types.js';

console.log('\nincremental/decide.spec.ts');

function pack(
	overrides: Partial<RulePack['manifest']> = {},
	body = 'audit',
): RulePack {
	return {
		manifest: {
			name: 'db-safety',
			version: '1.0.0',
			description: '',
			appliesTo: {paths: ['**/*.ts'], languages: ['typescript']},
			severityWeighting: {},
			dependsOn: [],
			category: 'security',
			...overrides,
		},
		body,
	};
}

/** A probe that reports the given changed paths, or null for "cannot tell". */
function probe(changed: string[] | null, head = 'abc123'): GitProbe {
	return {
		head: () => head,
		changedSince: () => changed,
	};
}

function cached(overrides: Partial<PackCacheEntry> = {}): PackCacheEntry {
	return {
		pack: 'db-safety',
		packVersion: '1.0.0',
		bodyHash: packBodyHash(pack()),
		dependencyHash: dependencyHash([]),
		sha: 'old-sha',
		...overrides,
	};
}

function input(overrides: Partial<DecideInput> = {}): DecideInput {
	return {
		pack: pack(),
		repoDir: '/ws/repo',
		cached: cached(),
		dependencies: [],
		incremental: true,
		forced: false,
		probe: probe([]),
		...overrides,
	};
}

test('a target that did not opt in reads everything', t => {
	const plan = decidePackScope(input({incremental: false}));
	t.is(plan.kind, 'full');
	t.is(plan.kind === 'full' ? plan.reason : '', 'incremental-disabled');
});

test('--full reads everything even with a valid cache', t => {
	const plan = decidePackScope(input({forced: true}));
	t.is(plan.kind === 'full' ? plan.reason : '', 'forced');
});

test('no cache entry reads everything', t => {
	// The first run in a repository. This is also what guarantees issues filed
	// before the scope markers existed get marked before any file is skipped.
	const plan = decidePackScope(input({cached: undefined}));
	t.is(plan.kind === 'full' ? plan.reason : '', 'no-cache');
});

test('a bumped pack version reads everything', t => {
	const plan = decidePackScope(input({cached: cached({packVersion: '0.9.0'})}));
	t.is(plan.kind === 'full' ? plan.reason : '', 'pack-changed');
});

test('an edited body with no version bump still reads everything', t => {
	// Version alone is not enough. A pack whose prompt was edited in place asks
	// a different question, and answering it needs every file back.
	const plan = decidePackScope(
		input({cached: cached({bodyHash: 'stale-hash'})}),
	);
	t.is(plan.kind === 'full' ? plan.reason : '', 'pack-changed');
});

test('an edited dependency reads everything', t => {
	// A dependency's body is part of this pack's prompt. Without this, editing a
	// shared rust-general pack would leave every dependent answering the old
	// question against files it had already written off as unchanged.
	const dependency = pack({name: 'ts-general'}, 'new dependency body');
	const plan = decidePackScope(
		input({
			dependencies: [dependency],
			cached: cached({dependencyHash: dependencyHash([])}),
		}),
	);
	t.is(plan.kind === 'full' ? plan.reason : '', 'dependency-changed');
});

test('an unchanged dependency does not force a full pass', t => {
	const dependency = pack({name: 'ts-general'}, 'dependency body');
	const plan = decidePackScope(
		input({
			dependencies: [dependency],
			cached: cached({dependencyHash: dependencyHash([dependency])}),
		}),
	);
	t.is(plan.kind, 'partial');
});

test('an unreachable cached commit reads everything', t => {
	// A shallow clone, or a force-push that orphaned the commit. "Cannot tell"
	// must never collapse into "nothing changed".
	const plan = decidePackScope(input({probe: probe(null)}));
	t.is(plan.kind === 'full' ? plan.reason : '', 'sha-unreachable');
});

test('a clean cache with no changes scans nothing', t => {
	const plan = decidePackScope(input({probe: probe([])}));
	t.deepEqual(plan, {kind: 'partial', paths: []});
});

test('only changed files the pack applies to are scanned', t => {
	const plan = decidePackScope(
		input({probe: probe(['src/a.ts', 'README.md', 'src/b.ts'])}),
	);
	t.deepEqual(plan, {kind: 'partial', paths: ['src/a.ts', 'src/b.ts']});
});

test('a pack with no path patterns takes the whole diff', t => {
	const plan = decidePackScope(
		input({
			pack: pack({appliesTo: {paths: [], languages: []}}),
			cached: cached({
				bodyHash: packBodyHash(pack({appliesTo: {paths: [], languages: []}})),
			}),
			probe: probe(['src/a.ts', 'README.md']),
		}),
	);
	t.deepEqual(plan, {kind: 'partial', paths: ['src/a.ts', 'README.md']});
});

test('dependency order is part of the hash', t => {
	const a = pack({name: 'a'}, 'body a');
	const b = pack({name: 'b'}, 'body b');
	t.not(dependencyHash([a, b]), dependencyHash([b, a]));
});

test('no dependencies hashes consistently', t => {
	t.is(dependencyHash([]), dependencyHash([]));
});

test('every full reason has a sentence', t => {
	// The report says why a pack read everything. A reason with no sentence
	// would surface as an empty explanation exactly when someone is asking why
	// their incremental run was not incremental.
	for (const reason of [
		'incremental-disabled',
		'forced',
		'no-cache',
		'pack-changed',
		'dependency-changed',
		'sha-unreachable',
	] as const) {
		t.true(explainFullReason(reason).length > 0, reason);
	}
});
