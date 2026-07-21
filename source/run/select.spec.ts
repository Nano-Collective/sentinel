import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import {isEnabledPackPath, unionPatterns} from './select.js';

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

function pack(paths: string[]): RulePack {
	return {
		manifest: {
			name: 'p',
			version: '1.0.0',
			description: '',
			appliesTo: {paths, languages: []},
			severityWeighting: {},
			dependsOn: [],
			category: '',
		},
		body: 'audit',
	};
}

test('unionPatterns collects every packs paths', t => {
	const patterns = unionPatterns([pack(['a/**']), pack(['b/**', 'a/**'])]);
	t.deepEqual(patterns.sort(), ['a/**', 'b/**']);
});

test('unionPatterns returns empty (whole repo) if any pack is unscoped', t => {
	t.deepEqual(unionPatterns([pack(['a/**']), pack([])]), []);
});
