import test from 'ava';
import {
	fullScope,
	isCompleteScope,
	issueWasScanned,
	type ScanScope,
} from './scope.js';

console.log('\ndedup/scope.spec.ts');

/** A scope in which `pack` read exactly `paths` and nothing else. */
function partial(
	pack: string,
	paths: string[],
	full: string[] = [],
): ScanScope {
	return {
		scannedByPack: new Map([[pack, new Set(paths)]]),
		fullPacks: new Set(full),
	};
}

test('a full scope is complete', t => {
	t.true(isCompleteScope(fullScope(['a', 'b'])));
});

test('a scope with any reduced pack is not complete', t => {
	t.false(isCompleteScope(partial('a', ['x.ts'])));
});

test('no scope at all means everything was scanned', t => {
	// The pre-incremental caller passes nothing, and must keep its behaviour.
	t.true(issueWasScanned(undefined, 'a', 'x.ts'));
	t.true(issueWasScanned(undefined, null, null));
});

test('a complete scope means everything was scanned', t => {
	t.true(issueWasScanned(fullScope(['a']), 'a', 'x.ts'));
	t.true(issueWasScanned(fullScope(['a']), 'a', 'never-heard-of-it.ts'));
});

test('a file the pack read this run counts as scanned', t => {
	t.true(issueWasScanned(partial('a', ['x.ts', 'y.ts']), 'a', 'x.ts'));
});

test('a file the pack skipped is NOT scanned — the whole point', t => {
	// This is the bug the module exists to prevent: without it, an unscanned
	// file's finding is absent from the run, gets its miss counter bumped, and
	// after `resolveAfterMisses` runs the issue is closed as fixed.
	t.false(issueWasScanned(partial('a', ['x.ts']), 'a', 'untouched.ts'));
});

test('scope is per pack, not per repository', t => {
	// Pack `b` read the file; pack `a` did not. An issue `a` filed against it
	// was not re-examined, even though something looked at the file. Collapsing
	// the two packs would reintroduce the bug for any multi-pack repo.
	const scope: ScanScope = {
		scannedByPack: new Map([
			['a', new Set(['other.ts'])],
			['b', new Set(['shared.ts'])],
		]),
		fullPacks: new Set(),
	};
	t.false(issueWasScanned(scope, 'a', 'shared.ts'));
	t.true(issueWasScanned(scope, 'b', 'shared.ts'));
});

test('a pack that read everything covers its files even when another was partial', t => {
	const scope = partial('a', ['x.ts'], ['b']);
	t.true(issueWasScanned(scope, 'b', 'anything.ts'));
	t.false(issueWasScanned(scope, 'a', 'anything.ts'));
});

test('a pack that did not run at all ages out as it always has', t => {
	// The target stopped naming the pack, or its depends_on chain broke. That is
	// not an incremental skip, and holding those issues forever would mean a
	// removed pack's findings could never close.
	t.true(issueWasScanned(partial('a', ['x.ts']), 'removed-pack', 'x.ts'));
});

test('an unmarked issue is scanned on a complete run', t => {
	// Issues filed before the markers existed keep exactly today's behaviour for
	// as long as runs read everything, which is what makes the upgrade a no-op.
	t.true(issueWasScanned(fullScope(['a']), null, null));
});

test('an unmarked issue is HELD on a partial run', t => {
	// Deliberately the opposite of the complete-run case. An issue that cannot
	// be attributed to a file is one we cannot prove we looked at, and holding
	// is recoverable where closing is not.
	t.false(issueWasScanned(partial('a', ['x.ts']), null, null));
	t.false(issueWasScanned(partial('a', ['x.ts']), 'a', null));
	t.false(issueWasScanned(partial('a', ['x.ts']), null, 'x.ts'));
});
