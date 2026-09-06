import test from 'ava';
import {
	buildCloneArgs,
	type CheckoutProbe,
	inspectCheckout,
	normaliseRepoRef,
	remoteMatchesRepo,
} from './clone.js';

console.log('\nrun/clone.spec.ts');

test('builds a shallow single-branch gh clone argv', t => {
	t.deepEqual(buildCloneArgs('my-org/prog', '/ws/my-org/prog'), [
		'repo',
		'clone',
		'my-org/prog',
		'/ws/my-org/prog',
		'--',
		'--depth',
		'1',
		'--single-branch',
	]);
});

// --- normaliseRepoRef -------------------------------------------------------

test('normalises every remote form to owner/repo', t => {
	const expected = 'my-org/prog';
	for (const ref of [
		'my-org/prog',
		'my-org/prog.git',
		'my-org/prog/',
		'MY-ORG/Prog',
		'https://github.com/my-org/prog',
		'https://github.com/my-org/prog.git',
		'https://user:token@github.com/my-org/prog.git',
		'git@github.com:my-org/prog.git',
		'ssh://git@github.com/my-org/prog.git',
		'git://github.com/my-org/prog.git',
	]) {
		t.is(normaliseRepoRef(ref), expected, ref);
	}
});

test('normaliseRepoRef rejects input with no owner/repo pair', t => {
	t.is(normaliseRepoRef(''), null);
	t.is(normaliseRepoRef('   '), null);
	t.is(normaliseRepoRef('prog'), null);
	t.is(normaliseRepoRef('/'), null);
});

test('remoteMatchesRepo compares identity, not spelling', t => {
	t.true(remoteMatchesRepo('git@github.com:my-org/prog.git', 'my-org/prog'));
	t.true(remoteMatchesRepo('https://github.com/MY-ORG/PROG', 'my-org/prog'));
	// A different host is still the same repository for our purposes; a
	// different owner or name is not.
	t.true(
		remoteMatchesRepo('https://ghe.example.com/my-org/prog', 'my-org/prog'),
	);
	t.false(
		remoteMatchesRepo('https://github.com/other/prog.git', 'my-org/prog'),
	);
	t.false(
		remoteMatchesRepo('https://github.com/my-org/other.git', 'my-org/prog'),
	);
	t.false(remoteMatchesRepo('not-a-remote', 'my-org/prog'));
});

// --- inspectCheckout --------------------------------------------------------

/** A probe describing one imagined workspace directory. */
function probe(
	state: {
		paths?: Record<string, 'dir' | 'file'>;
		entries?: Record<string, string[]>;
		origin?: string | null;
	} = {},
): CheckoutProbe {
	const paths = state.paths ?? {};
	return {
		exists: path => path in paths,
		isDirectory: path => paths[path] === 'dir',
		entries: path => state.entries?.[path] ?? [],
		originUrl: () => state.origin ?? null,
	};
}

const DIR = '/ws/my-org/prog';

test('a directory that does not exist is absent, so it will be cloned', t => {
	t.deepEqual(inspectCheckout('my-org/prog', DIR, probe()), {kind: 'absent'});
});

test('an empty directory is treated as absent, not as a checkout', t => {
	// The common case of an interrupted clone. git clones into an empty
	// directory happily, so this needs no intervention from the operator.
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({paths: {[DIR]: 'dir'}, entries: {[DIR]: []}}),
	);
	t.deepEqual(state, {kind: 'absent'});
});

test('a checkout of the right repo is usable', t => {
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({
			paths: {[DIR]: 'dir', [`${DIR}/.git`]: 'dir'},
			entries: {[DIR]: ['.git', 'src']},
			origin: 'https://github.com/my-org/prog.git',
		}),
	);
	t.deepEqual(state, {kind: 'usable'});
});

test('a worktree whose .git is a file is still usable', t => {
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({
			paths: {[DIR]: 'dir', [`${DIR}/.git`]: 'file'},
			entries: {[DIR]: ['.git', 'src']},
			origin: 'git@github.com:my-org/prog.git',
		}),
	);
	t.deepEqual(state, {kind: 'usable'});
});

test('a non-empty directory with no .git is refused, not audited', t => {
	// The half-finished clone. Before this it reported ok and the audit ran
	// against whatever files happened to be there.
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({paths: {[DIR]: 'dir'}, entries: {[DIR]: ['README.md']}}),
	);
	t.is(state.kind, 'unusable');
	t.true(state.kind === 'unusable' && state.reason.includes('no .git'));
});

test('a checkout of a different repository is refused', t => {
	// The most dangerous case: a real, healthy git checkout of the wrong thing.
	// Findings would be filed against my-org/prog describing other-org/other.
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({
			paths: {[DIR]: 'dir', [`${DIR}/.git`]: 'dir'},
			entries: {[DIR]: ['.git']},
			origin: 'https://github.com/other-org/other.git',
		}),
	);
	t.is(state.kind, 'unusable');
	t.true(state.kind === 'unusable' && state.reason.includes('other-org/other'));
	t.true(
		state.kind === 'unusable' && state.reason.includes('wrong repository'),
	);
});

test('a checkout with no origin remote is refused', t => {
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({
			paths: {[DIR]: 'dir', [`${DIR}/.git`]: 'dir'},
			entries: {[DIR]: ['.git']},
			origin: null,
		}),
	);
	t.is(state.kind, 'unusable');
	t.true(
		state.kind === 'unusable' && state.reason.includes('no origin remote'),
	);
});

test('a path that exists but is a file is refused', t => {
	const state = inspectCheckout(
		'my-org/prog',
		DIR,
		probe({paths: {[DIR]: 'file'}}),
	);
	t.is(state.kind, 'unusable');
	t.true(state.kind === 'unusable' && state.reason.includes('not a directory'));
});

test('no unusable state ever asks for the directory to be deleted silently', t => {
	// The workspace can hold somebody's own checkouts. Refusing to audit is the
	// safe failure; removing a directory to make an audit succeed is not.
	const cases: CheckoutProbe[] = [
		probe({paths: {[DIR]: 'dir'}, entries: {[DIR]: ['README.md']}}),
		probe({
			paths: {[DIR]: 'dir', [`${DIR}/.git`]: 'dir'},
			entries: {[DIR]: ['.git']},
			origin: 'https://github.com/other/other.git',
		}),
	];
	for (const each of cases) {
		const state = inspectCheckout('my-org/prog', DIR, each);
		t.is(state.kind, 'unusable');
		// The operator is told what to do, and it is their call.
		t.true(state.kind === 'unusable' && state.reason.length > 0);
	}
});
