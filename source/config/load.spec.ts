import test from 'ava';
import {loadConfigFrom} from './load.js';

console.log('\nconfig/load.spec.ts');

const VALID = `targets:
  - repo: my-org/a
    rule_packs: [p]
schedule: "0 6 * * *"
severity_threshold: medium
model:
  provider: ollama
  model: llama3.1
issues:
  label: sentinel
`;

/** A reader that fails the way node's readFileSync fails on a missing file. */
function missingFile(): never {
	const error = new Error(
		"ENOENT: no such file or directory, open 'sentinel.yaml'",
	) as NodeJS.ErrnoException;
	error.code = 'ENOENT';
	throw error;
}

test('loads a valid config', t => {
	const result = loadConfigFrom('sentinel.yaml', () => VALID);
	t.truthy(result.config);
	t.deepEqual(result.errors, []);
	t.falsy(result.unreadable);
});

test('a missing config is reported, not thrown', t => {
	// The bug: readFileSync threw straight past the error reporting below it, so
	// the first thing a new user saw was a stack trace.
	const result = loadConfigFrom('sentinel.yaml', missingFile);
	t.falsy(result.config);
	t.is(result.errors.length, 1);
	t.true(result.errors[0]?.startsWith('config error — sentinel.yaml:'));
	t.true(result.errors[0]?.includes('ENOENT'));
	t.true(result.unreadable);
});

test('an unreadable config is reported, not thrown', t => {
	const result = loadConfigFrom('sentinel.yaml', () => {
		throw new Error('EACCES: permission denied');
	});
	t.falsy(result.config);
	t.true(result.errors[0]?.includes('permission denied'));
	t.true(result.unreadable);
});

test('a non-Error throw is still reported', t => {
	const result = loadConfigFrom('sentinel.yaml', () => {
		throw 'something odd';
	});
	t.true(result.errors[0]?.includes('something odd'));
	t.true(result.unreadable);
});

test('an invalid config reports parse errors and is not unreadable', t => {
	const result = loadConfigFrom('sentinel.yaml', () => 'targets: []\n');
	t.falsy(result.config);
	t.true(result.errors.length > 0);
	t.true(result.errors.every(error => error.startsWith('config error — ')));
	// Distinguishing the two matters: the "run sentinel init" hint is help on a
	// missing file and noise on a malformed one.
	t.falsy(result.unreadable);
});

test('every failure mode reports through the same prefix', t => {
	const unreadable = loadConfigFrom('sentinel.yaml', missingFile);
	const invalid = loadConfigFrom('sentinel.yaml', () => 'targets: []\n');
	for (const line of [...unreadable.errors, ...invalid.errors]) {
		t.true(line.startsWith('config error — '));
	}
});
