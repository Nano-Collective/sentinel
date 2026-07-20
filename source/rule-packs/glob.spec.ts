import test from 'ava';
import {matchesAppliesTo, matchesGlob} from './glob.js';
import type {RulePackManifest} from './types.js';

console.log('\nrule-packs/glob.spec.ts');

test('* matches within a single segment only', t => {
	t.true(matchesGlob('src/*.ts', 'src/index.ts'));
	t.false(matchesGlob('src/*.ts', 'src/nested/index.ts'));
});

test('** crosses segment boundaries', t => {
	t.true(matchesGlob('programs/**/*.rs', 'programs/vault/src/lib.rs'));
	t.true(matchesGlob('programs/**/*.rs', 'programs/token.rs'));
	t.false(matchesGlob('programs/**/*.rs', 'services/api.rs'));
});

test('leading **/ matches files at the root', t => {
	t.true(matchesGlob('**/*.sol', 'Token.sol'));
	t.true(matchesGlob('**/*.sol', 'contracts/Token.sol'));
});

test('? matches a single non-slash character', t => {
	t.true(matchesGlob('v?.ts', 'v1.ts'));
	t.false(matchesGlob('v?.ts', 'v10.ts'));
	t.false(matchesGlob('v?.ts', 'v/.ts'));
});

test('dots in the pattern are literal', t => {
	t.true(matchesGlob('a.b.ts', 'a.b.ts'));
	t.false(matchesGlob('a.b.ts', 'axbxts'));
});

function manifest(paths: string[]): RulePackManifest {
	return {
		name: 'p',
		version: '1.0.0',
		description: '',
		appliesTo: {paths, languages: []},
		severityWeighting: {},
		dependsOn: [],
		category: '',
	};
}

test('matchesAppliesTo applies to the whole repo when paths is empty', t => {
	t.true(matchesAppliesTo(manifest([]), 'anything/at/all.py'));
});

test('matchesAppliesTo matches when any pattern matches', t => {
	const m = manifest(['programs/**/*.rs', 'src/**/*.ts']);
	t.true(matchesAppliesTo(m, 'src/app/main.ts'));
	t.true(matchesAppliesTo(m, 'programs/vault/lib.rs'));
	t.false(matchesAppliesTo(m, 'docs/readme.md'));
});
