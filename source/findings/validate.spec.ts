import test from 'ava';
import type {Finding} from './types.js';
import {validateFindings} from './validate.js';

console.log('\nfindings/validate.spec.ts');

function validFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'solana-anchor/missing-signer-check',
		file: 'programs/vault/src/lib.rs',
		lineRange: {start: 42, end: 48},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'pub fn withdraw(ctx: Context<Withdraw>) {',
		...overrides,
	};
}

test('accepts a well-formed array of findings', t => {
	const result = validateFindings([validFinding()]);
	t.true(result.valid);
	t.is(result.findings.length, 1);
	t.deepEqual(result.errors, []);
});

test('accepts a JSON string and parses it', t => {
	const result = validateFindings(JSON.stringify([validFinding()]));
	t.true(result.valid);
	t.is(result.findings.length, 1);
});

test('rejects malformed JSON with a document-level error', t => {
	const result = validateFindings('[{not valid json');
	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.is(result.errors[0]?.index, -1);
	t.is(result.errors[0]?.field, 'document');
});

test('rejects a non-array top level', t => {
	const result = validateFindings({finding: validFinding()});
	t.false(result.valid);
	t.is(result.errors[0]?.field, 'document');
});

test('rejects a severity outside the allowed set', t => {
	const result = validateFindings([
		validFinding({severity: 'blocker' as never}),
	]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'severity'));
	t.is(result.findings.length, 0);
});

test('rejects a finding that cites no file', t => {
	const result = validateFindings([validFinding({file: ''})]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'file'));
});

test('rejects a finding with a missing line range', t => {
	const {lineRange, ...withoutRange} = validFinding();
	const result = validateFindings([withoutRange]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'lineRange'));
});

test('rejects an inverted line range', t => {
	const result = validateFindings([
		validFinding({lineRange: {start: 50, end: 10}}),
	]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'lineRange'));
});

test('rejects an invalid confidence value', t => {
	const result = validateFindings([
		validFinding({confidence: 'certain' as never}),
	]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'confidence'));
});

test('reports errors for each field of a wholly malformed finding', t => {
	const result = validateFindings([{}]);
	t.false(result.valid);
	// rule, file, lineRange, category, severity, confidence, offendingSnippet
	t.true(result.errors.length >= 7);
	t.is(result.findings.length, 0);
});

test('tags each error with the index of the offending finding', t => {
	const result = validateFindings([validFinding(), validFinding({file: ''})]);
	t.false(result.valid);
	t.true(result.errors.every(e => e.index === 1));
	// The first finding still validated.
	t.is(result.findings.length, 1);
});
