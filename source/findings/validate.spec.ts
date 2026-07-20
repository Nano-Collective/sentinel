import test from 'ava';
import {validateFindings} from './validate.js';

console.log('\nfindings/validate.spec.ts');

/** A well-formed finding in the snake_case wire shape the model emits. */
function validFinding(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		rule: 'solana-anchor/missing-signer-check',
		file: 'programs/vault/src/lib.rs',
		line_range: {start: 42, end: 48},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offending_snippet: 'pub fn withdraw(ctx: Context<Withdraw>) {',
		...overrides,
	};
}

test('accepts a well-formed array and normalises to camelCase', t => {
	const result = validateFindings([validFinding()]);
	t.true(result.valid);
	t.is(result.findings.length, 1);
	t.deepEqual(result.errors, []);
	// Wire snake_case is normalised to the camelCase Finding model.
	t.deepEqual(result.findings[0]?.lineRange, {start: 42, end: 48});
	t.is(
		result.findings[0]?.offendingSnippet,
		'pub fn withdraw(ctx: Context<Withdraw>) {',
	);
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
	const result = validateFindings([validFinding({severity: 'blocker'})]);
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
	const {line_range, ...withoutRange} = validFinding();
	const result = validateFindings([withoutRange]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'line_range'));
});

test('rejects an inverted line range', t => {
	const result = validateFindings([
		validFinding({line_range: {start: 50, end: 10}}),
	]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'line_range'));
});

test('rejects an invalid confidence value', t => {
	const result = validateFindings([validFinding({confidence: 'certain'})]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'confidence'));
});

test('reports errors for each field of a wholly malformed finding', t => {
	const result = validateFindings([{}]);
	t.false(result.valid);
	// rule, file, line_range, category, severity, confidence, offending_snippet
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
