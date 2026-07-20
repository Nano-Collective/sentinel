import test from 'ava';
import {parseRepoOverride} from './repo-override.js';

console.log('\nconfig/repo-override.spec.ts');

test('parses a full override', t => {
	const result = parseRepoOverride(`
severity_threshold: high
suppress:
  - rule: solana-anchor/pda-derivation
    paths: ["programs/vault/**"]
    reason: "vault module is exempt by design"
  - paths: ["scripts/**"]
    reason: "generated code"
`);
	t.true(result.valid);
	t.is(result.override?.severityThreshold, 'high');
	t.is(result.override?.suppress.length, 2);
	t.is(result.override?.suppress[0]?.rule, 'solana-anchor/pda-derivation');
	t.deepEqual(result.override?.suppress[0]?.paths, ['programs/vault/**']);
	t.is(result.override?.suppress[1]?.rule, undefined);
});

test('treats an empty file as a valid no-op override', t => {
	const result = parseRepoOverride('');
	t.true(result.valid);
	t.deepEqual(result.override, {suppress: []});
});

test('treats a comment-only (null) document as a no-op override', t => {
	const result = parseRepoOverride('# nothing here\n');
	t.true(result.valid);
	t.deepEqual(result.override?.suppress, []);
});

test('rejects invalid YAML', t => {
	const result = parseRepoOverride('suppress: [unterminated');
	t.false(result.valid);
	t.is(result.errors[0]?.field, 'document');
});

test('rejects a suppression with neither rule nor paths', t => {
	const result = parseRepoOverride(`
suppress:
  - reason: "why"
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'suppress[0]'));
});

test('rejects an out-of-scale threshold override', t => {
	const result = parseRepoOverride('severity_threshold: blocker\n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'severity_threshold'));
});

test('rejects non-list suppress', t => {
	const result = parseRepoOverride('suppress: nope\n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'suppress'));
});

test('rejects empty paths on a suppression', t => {
	const result = parseRepoOverride(`
suppress:
  - rule: some/rule
    paths: []
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'suppress[0].paths'));
});
