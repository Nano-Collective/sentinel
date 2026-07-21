import test from 'ava';
import {parseInitArgs} from './args.js';

console.log('\ninit/args.spec.ts');

test('applies defaults with no arguments', t => {
	const {options, dir, force, yes, errors} = parseInitArgs([]);
	t.is(options.provider, 'ollama');
	t.is(options.schedule, '0 6 * * *');
	t.is(options.severityThreshold, 'medium');
	t.is(options.label, 'sentinel');
	t.deepEqual(options.targets, []);
	t.is(dir, '.');
	t.false(force);
	t.false(yes);
	t.deepEqual(errors, []);
});

test('parses --flag value form', t => {
	const {options} = parseInitArgs([
		'--provider',
		'lmstudio',
		'--model',
		'qwen2.5',
		'--schedule',
		'0 9 * * 1',
	]);
	t.is(options.provider, 'lmstudio');
	t.is(options.model, 'qwen2.5');
	t.is(options.schedule, '0 9 * * 1');
});

test('parses --flag=value form', t => {
	const {options} = parseInitArgs(['--label=audit', '--provider=ollama']);
	t.is(options.label, 'audit');
	t.is(options.provider, 'ollama');
});

test('splits comma-separated targets and trims them', t => {
	const {options} = parseInitArgs(['--targets', 'org/a, org/b ,org/c']);
	t.deepEqual(options.targets, ['org/a', 'org/b', 'org/c']);
});

test('parses boolean flags', t => {
	const {force, yes} = parseInitArgs(['--force', '--yes']);
	t.true(force);
	t.true(yes);
});

test('accepts a valid severity threshold', t => {
	const {options, errors} = parseInitArgs(['--severity-threshold', 'high']);
	t.is(options.severityThreshold, 'high');
	t.deepEqual(errors, []);
});

test('reports an unknown severity threshold', t => {
	const {options, errors} = parseInitArgs(['--severity-threshold', 'blocker']);
	// Falls back to the default and records the error.
	t.is(options.severityThreshold, 'medium');
	t.is(errors.length, 1);
	t.true(errors[0]?.includes('blocker'));
});

test('reads the target directory', t => {
	t.is(parseInitArgs(['--dir', 'my-config']).dir, 'my-config');
});
