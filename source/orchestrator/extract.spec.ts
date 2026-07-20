import test from 'ava';
import {extractJsonArray} from './extract.js';

console.log('\norchestrator/extract.spec.ts');

test('extracts a bare JSON array', t => {
	t.is(extractJsonArray('[{"a":1}]'), '[{"a":1}]');
});

test('extracts an array wrapped in prose', t => {
	const out = 'Here are my findings:\n[{"rule":"x"}]\nThat is all.';
	t.is(extractJsonArray(out), '[{"rule":"x"}]');
});

test('extracts an array from a fenced code block', t => {
	const out = 'Result:\n```json\n[{"rule":"x"}]\n```\n';
	t.is(extractJsonArray(out), '[{"rule":"x"}]');
});

test('returns the last top-level array (the final answer)', t => {
	const out =
		'For example [{"example":true}] is the shape. Final answer:\n[{"rule":"real"}]';
	t.is(extractJsonArray(out), '[{"rule":"real"}]');
});

test('handles nested arrays without splitting them', t => {
	const out = 'x [{"line_range":{"start":1,"end":2}},{"tags":["a","b"]}] y';
	t.is(
		extractJsonArray(out),
		'[{"line_range":{"start":1,"end":2}},{"tags":["a","b"]}]',
	);
});

test('ignores brackets inside string literals', t => {
	const out = '[{"snippet":"arr[i] = ]["}]';
	t.is(extractJsonArray(out), '[{"snippet":"arr[i] = ]["}]');
});

test('handles escaped quotes inside strings', t => {
	const out = '[{"snippet":"say \\"hi\\" ]["}]';
	t.is(extractJsonArray(out), '[{"snippet":"say \\"hi\\" ]["}]');
});

test('returns the empty array when the model found nothing', t => {
	t.is(extractJsonArray('No issues found.\n[]'), '[]');
});

test('returns null when there is no array', t => {
	t.is(extractJsonArray('I could not complete the audit.'), null);
});

test('returns null when a bracket span is not valid JSON', t => {
	t.is(extractJsonArray('see [1, 2, unterminated'), null);
});
