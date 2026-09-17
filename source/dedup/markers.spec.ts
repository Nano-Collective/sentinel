import test from 'ava';
import {readMarker, readMisses, upsertMarker} from './markers.js';

console.log('\ndedup/markers.spec.ts');

test('readMarker returns null when the marker is absent', t => {
	t.is(readMarker('a plain body', 'hash'), null);
});

test('upsertMarker appends a new marker', t => {
	const body = upsertMarker('body text', 'hash', 'abc123');
	t.is(readMarker(body, 'hash'), 'abc123');
	t.true(body.includes('<!-- sentinel:hash=abc123 -->'));
});

test('upsertMarker replaces an existing marker in place', t => {
	const once = upsertMarker('body', 'misses', '1');
	const twice = upsertMarker(once, 'misses', '2');
	t.is(readMarker(twice, 'misses'), '2');
	// Only one marker for the key.
	t.is(twice.split('sentinel:misses=').length - 1, 1);
});

test('markers for different keys coexist', t => {
	let body = 'body';
	body = upsertMarker(body, 'hash', 'deadbeef');
	body = upsertMarker(body, 'misses', '3');
	t.is(readMarker(body, 'hash'), 'deadbeef');
	t.is(readMarker(body, 'misses'), '3');
});

test('readMisses defaults to 0 and parses the counter', t => {
	t.is(readMisses('no marker'), 0);
	t.is(readMisses(upsertMarker('b', 'misses', '4')), 4);
	t.is(readMisses(upsertMarker('b', 'misses', 'nonsense')), 0);
});

test('a marker value does not leak into readMarker of another key', t => {
	const body = upsertMarker('b', 'last-seen', '2026-07-21T06:00:00.000Z');
	t.is(readMarker(body, 'last-seen'), '2026-07-21T06:00:00.000Z');
	t.is(readMarker(body, 'hash'), null);
});

test('upsertMarker appends when a quoted opener has no close', t => {
	const quoted = 'body with `<!-- sentinel:hash=` quoted from audited code';
	const body = upsertMarker(quoted, 'hash', 'abc123');
	// The quoted text is left alone and exactly one real marker is added.
	t.true(body.startsWith(quoted));
	t.is(readMarker(body, 'hash'), 'abc123');
	t.is(body.split('<!-- sentinel:hash=').length - 1, 2);
});

test('upsertMarker does not splice against a quoted opener', t => {
	// A quoted opener ahead of the real markers used to borrow the next
	// marker's close, so the splice deleted everything in between.
	const stored = [
		'### Offending code',
		'```',
		'let s = "<!-- sentinel:misses=";',
		'```',
		'',
		'trailing content',
		'<!-- sentinel:hash=realhash -->',
		'<!-- sentinel:misses=0 -->',
	].join('\n');

	t.is(readMarker(stored, 'misses'), '0');

	const aged = upsertMarker(stored, 'misses', '1');
	t.true(aged.includes('trailing content'));
	t.is(readMarker(aged, 'hash'), 'realhash');
	t.is(readMarker(aged, 'misses'), '1');
});
