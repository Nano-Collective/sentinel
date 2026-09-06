import test from 'ava';
import {flagAll, flagBool, flagStr, parseFlags} from './flags.js';

console.log('\nargs/flags.spec.ts');

test('parses --key value', t => {
	const flags = parseFlags(['--config', 'a.yaml']);
	t.is(flagStr(flags, 'config'), 'a.yaml');
});

test('parses --key=value', t => {
	const flags = parseFlags(['--config=a.yaml']);
	t.is(flagStr(flags, 'config'), 'a.yaml');
});

test('parses a bare boolean flag', t => {
	const flags = parseFlags(['--dry-run']);
	t.true(flagBool(flags, 'dry-run'));
	t.is(flagStr(flags, 'dry-run'), undefined);
});

test('a bare flag before another flag stays boolean', t => {
	const flags = parseFlags(['--dry-run', '--config', 'a.yaml']);
	t.true(flagBool(flags, 'dry-run'));
	t.is(flagStr(flags, 'config'), 'a.yaml');
});

test('an absent flag is neither set nor true', t => {
	const flags = parseFlags([]);
	t.is(flagStr(flags, 'config'), undefined);
	t.false(flagBool(flags, 'config'));
	t.deepEqual(flagAll(flags, 'config'), []);
});

test('ignores positional arguments', t => {
	const flags = parseFlags(['run', 'extra', '--config', 'a.yaml']);
	t.is(flagStr(flags, 'config'), 'a.yaml');
});

// --- repeatable flags -------------------------------------------------------

test('--rule-pack is repeatable and keeps every value in order', t => {
	// The bug: the parser stored one value per key, so this silently ran only
	// the last pack while the help text presented the flag as the way to choose
	// packs in local mode.
	const flags = parseFlags([
		'--rule-pack',
		'packs/a.md',
		'--rule-pack',
		'packs/b.md',
	]);
	t.deepEqual(flagAll(flags, 'rule-pack'), ['packs/a.md', 'packs/b.md']);
});

test('repeated --key=value form is collected too', t => {
	const flags = parseFlags(['--rule-pack=a.md', '--rule-pack=b.md']);
	t.deepEqual(flagAll(flags, 'rule-pack'), ['a.md', 'b.md']);
});

test('the two spellings mix', t => {
	const flags = parseFlags(['--rule-pack=a.md', '--rule-pack', 'b.md']);
	t.deepEqual(flagAll(flags, 'rule-pack'), ['a.md', 'b.md']);
});

test('a repeated value is not de-duplicated', t => {
	// Running the same pack twice is the caller's business, not the parser's.
	const flags = parseFlags(['--rule-pack', 'a.md', '--rule-pack', 'a.md']);
	t.deepEqual(flagAll(flags, 'rule-pack'), ['a.md', 'a.md']);
});

test('single-valued flags keep last-one-wins', t => {
	// Unchanged from before flags became repeatable, so nothing else shifts.
	const flags = parseFlags(['--config', 'a.yaml', '--config', 'b.yaml']);
	t.is(flagStr(flags, 'config'), 'b.yaml');
});

test('flagStr reads past a trailing bare occurrence', t => {
	const flags = parseFlags(['--config', 'a.yaml', '--config']);
	t.is(flagStr(flags, 'config'), 'a.yaml');
	t.true(flagBool(flags, 'config'));
});

test('flagAll skips valueless occurrences', t => {
	const flags = parseFlags(['--rule-pack', '--rule-pack', 'b.md']);
	t.deepEqual(flagAll(flags, 'rule-pack'), ['b.md']);
});
