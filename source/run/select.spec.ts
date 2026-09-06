import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import {isEnabledPackPath, selectPacks, unionPatterns} from './select.js';

console.log('\nrun/select.spec.ts');

test('enabled pack paths are .md with no underscore segment', t => {
	t.true(isEnabledPackPath('solana-anchor.md'));
	t.true(isEnabledPackPath('nested/rust-general.md'));
});

test('underscore-prefixed segments are disabled', t => {
	t.false(isEnabledPackPath('_starter/example.md'));
	t.false(isEnabledPackPath('_draft.md'));
});

test('non-markdown files are not packs', t => {
	t.false(isEnabledPackPath('README.txt'));
	t.false(isEnabledPackPath('config.yaml'));
});

function pack(paths: string[], name = 'p', dependsOn: string[] = []): RulePack {
	return {
		manifest: {
			name,
			version: '1.0.0',
			description: '',
			appliesTo: {paths, languages: []},
			severityWeighting: {},
			dependsOn,
			category: '',
		},
		body: 'audit',
	};
}

const NAMED = (name: string, dependsOn: string[] = []): RulePack =>
	pack(['a/**'], name, dependsOn);

test('selectPacks resolves named packs and their dependencies', t => {
	const {packs, missing} = selectPacks(
		[NAMED('app', ['base']), NAMED('base')],
		['app'],
	);
	t.deepEqual(packs.map(entry => entry.manifest.name).sort(), ['app', 'base']);
	t.deepEqual(missing, []);
});

test('selectPacks de-duplicates a pack named twice', t => {
	const {packs} = selectPacks(
		[NAMED('app', ['base']), NAMED('base')],
		['app', 'base'],
	);
	t.is(packs.length, 2);
});

test('selectPacks reports a name the directory does not have', t => {
	const {packs, missing} = selectPacks([NAMED('app')], ['app', 'gone']);
	t.deepEqual(missing, ['gone']);
	t.is(packs.length, 1);
});

test('selectPacks reports an unresolvable chain apart from a missing pack', t => {
	const {packs, missing, unresolved} = selectPacks(
		[NAMED('app', ['absent'])],
		['app'],
	);
	// `app` is in the directory. Reporting it as missing — which is what this
	// did before — sends the reader to look for a file that is already there.
	t.deepEqual(missing, []);
	t.is(unresolved.length, 1);
	t.is(unresolved[0]?.pack, 'app');
	t.true(unresolved[0]?.errors.length ? true : false);
	t.is(packs.length, 0);
});

test('selectPacks keeps missing and unresolved packs in separate channels', t => {
	const {missing, unresolved} = selectPacks(
		[NAMED('app', ['absent']), NAMED('fine')],
		['app', 'gone', 'fine'],
	);
	t.deepEqual(missing, ['gone']);
	t.deepEqual(
		unresolved.map(entry => entry.pack),
		['app'],
	);
});

test('selectPacks reports a dependency cycle as unresolved, not missing', t => {
	const {packs, missing, unresolved} = selectPacks(
		[NAMED('a', ['b']), NAMED('b', ['a'])],
		['a'],
	);
	t.deepEqual(missing, []);
	t.is(unresolved[0]?.pack, 'a');
	t.true(
		unresolved[0]?.errors.some(error => error.message.includes('cycle')) ??
			false,
	);
	t.is(packs.length, 0);
});

test('unionPatterns collects every packs paths', t => {
	const patterns = unionPatterns([pack(['a/**']), pack(['b/**', 'a/**'])]);
	t.deepEqual(patterns.sort(), ['a/**', 'b/**']);
});

test('unionPatterns returns empty (whole repo) if any pack is unscoped', t => {
	t.deepEqual(unionPatterns([pack(['a/**']), pack([])]), []);
});
