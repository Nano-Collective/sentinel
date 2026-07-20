import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import {runAudit} from './audit.js';
import type {ModelRunner, ModelRunResult} from './types.js';

console.log('\norchestrator/audit.spec.ts');

const MODEL: ModelConfig = {provider: 'ollama', model: 'llama3.1'};

/** A runner that returns a fixed result, recording what it was called with. */
function fakeRunner(result: ModelRunResult): ModelRunner & {calls: number} {
	return {
		calls: 0,
		async run() {
			this.calls++;
			return result;
		},
	};
}

const FINDING = {
	rule: 'p/r',
	file: 'a.rs',
	line_range: {start: 1, end: 2},
	category: 'security',
	severity: 'high',
	confidence: 'medium',
	offending_snippet: 'x',
};

test('returns validated findings on a clean run', async t => {
	const runner = fakeRunner({
		ok: true,
		output: `done: ${JSON.stringify([FINDING])}`,
	});
	const result = await runAudit('prompt', MODEL, runner);
	t.true(result.ok);
	t.is(result.findings.length, 1);
	t.is(result.findings[0]?.offendingSnippet, 'x');
	t.deepEqual(result.errors, []);
	t.is(runner.calls, 1);
});

test('accepts an empty findings array', async t => {
	const runner = fakeRunner({ok: true, output: 'No issues.\n[]'});
	const result = await runAudit('prompt', MODEL, runner);
	t.true(result.ok);
	t.is(result.findings.length, 0);
});

test('surfaces a process-level failure as runError', async t => {
	const runner = fakeRunner({
		ok: false,
		output: '',
		error: 'nanocoder not on PATH',
	});
	const result = await runAudit('prompt', MODEL, runner);
	t.false(result.ok);
	t.is(result.runError, 'nanocoder not on PATH');
	t.deepEqual(result.findings, []);
});

test('reports a document error when no array is present', async t => {
	const runner = fakeRunner({ok: true, output: 'I gave up.'});
	const result = await runAudit('prompt', MODEL, runner);
	t.false(result.ok);
	t.is(result.errors[0]?.field, 'document');
	t.is(result.errors[0]?.index, -1);
});

test('surfaces validation errors for a malformed finding', async t => {
	const bad = {...FINDING, severity: 'blocker'};
	const runner = fakeRunner({ok: true, output: JSON.stringify([bad])});
	const result = await runAudit('prompt', MODEL, runner);
	t.false(result.ok);
	t.true(result.errors.some(e => e.field === 'severity'));
});

test('retains the raw output for logging', async t => {
	const runner = fakeRunner({ok: true, output: 'transcript...\n[]'});
	const result = await runAudit('prompt', MODEL, runner);
	t.is(result.raw, 'transcript...\n[]');
});
