import test from 'ava';
import {MAX_LINE} from './types.js';
import {type ValidationError, validateFindings} from './validate.js';

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

test('normalises the optional human-facing fields when present', t => {
	const result = validateFindings([
		validFinding({
			summary: 'Missing signer check',
			rationale: 'moves funds without asserting the signer',
			suggested_next_steps: 'add a Signer constraint',
		}),
	]);
	t.true(result.valid);
	t.is(result.findings[0]?.summary, 'Missing signer check');
	t.is(result.findings[0]?.suggestedNextSteps, 'add a Signer constraint');
});

test('rejects a non-string optional field', t => {
	const result = validateFindings([validFinding({summary: 42})]);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'summary'));
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

// A model that hallucinates a line number tends to emit one of these. They all
// slip past a bare `typeof === 'number'` gate, and a finding carrying one
// renders a `file:start` reference in the issue body that points nowhere.
//
// The cases are split by the gate that actually rejects them, and each asserts
// on the message rather than just the field: a value that drifts to the other
// gate then fails loudly instead of passing for the wrong reason.

/** Rejected by the `Number.isInteger` gate. */
const NON_INTEGER_LINE_NUMBERS: Array<[string, unknown]> = [
	['Infinity', Number.POSITIVE_INFINITY],
	['-Infinity', Number.NEGATIVE_INFINITY],
	['NaN', Number.NaN],
	['1.5', 1.5],
	// Not from the issue: a guard on dropping the old `typeof` gate, which is
	// the one thing that kept strings out.
	['a numeric string', '42'],
];

/**
 * Integral, so past the integer gate; rejected instead by the bound
 * 1 <= start <= end <= MAX_LINE.
 */
const OUT_OF_RANGE_LINE_NUMBERS: Array<[string, unknown]> = [
	// Number.isInteger(-0) is true, so only the lower bound catches it.
	['-0', -0],
	['1e20', 1e20],
];

function lineRangeMessage(errors: ValidationError[]): string {
	return errors.find(e => e.field === 'line_range')?.message ?? '';
}

for (const [label, value] of NON_INTEGER_LINE_NUMBERS) {
	test(`rejects a line range of ${label} as a non-integer`, t => {
		const result = validateFindings([
			validFinding({line_range: {start: value, end: value}}),
		]);
		t.false(result.valid);
		t.is(result.findings.length, 0);
		t.true(lineRangeMessage(result.errors).includes('must both be integers'));
	});
}

for (const [label, value] of OUT_OF_RANGE_LINE_NUMBERS) {
	test(`rejects a line range of ${label} as out of range`, t => {
		const result = validateFindings([
			validFinding({line_range: {start: value, end: value}}),
		]);
		t.false(result.valid);
		t.is(result.findings.length, 0);
		t.true(lineRangeMessage(result.errors).includes('must satisfy'));
	});
}

// MAX_LINE is imported rather than written out so retuning the constant cannot
// leave this pair passing while no longer straddling the boundary.
test('accepts a line range sitting on the upper bound', t => {
	const result = validateFindings([
		validFinding({line_range: {start: 1, end: MAX_LINE}}),
	]);
	t.true(result.valid);
	t.is(result.findings.length, 1);
});

test('rejects a line range one past the upper bound', t => {
	const result = validateFindings([
		validFinding({line_range: {start: 1, end: MAX_LINE + 1}}),
	]);
	t.false(result.valid);
	t.true(lineRangeMessage(result.errors).includes('must satisfy'));
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
