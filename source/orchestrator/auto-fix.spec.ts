import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import {buildAutoFixPrompt, runAuditWithAutoFix} from './auto-fix.js';
import type {AuditResult, ModelRunner, ModelRunResult} from './types.js';

console.log('\norchestrator/auto-fix.spec.ts');

const MODEL: ModelConfig = {provider: 'ollama', model: 'llama3.1'};

const GOOD = {
	rule: 'p/r',
	file: 'a.rs',
	line_range: {start: 1, end: 2},
	category: 'security',
	severity: 'high',
	confidence: 'medium',
	offending_snippet: 'x',
};
const BAD = {...GOOD, severity: 'blocker'};

/** A runner that returns a scripted sequence of results and records prompts. */
function queuedRunner(
	results: ModelRunResult[],
): ModelRunner & {calls: number; prompts: string[]} {
	return {
		calls: 0,
		prompts: [],
		async run(prompt) {
			this.prompts.push(prompt);
			const result = results[this.calls] ?? results[results.length - 1];
			this.calls++;
			return result as ModelRunResult;
		},
	};
}

test('returns on the first attempt when the output is valid', async t => {
	const runner = queuedRunner([{ok: true, output: JSON.stringify([GOOD])}]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner);
	t.true(result.ok);
	t.is(result.attempts, 1);
	t.is(runner.calls, 1);
});

test('retries with the error report and succeeds on the second attempt', async t => {
	const runner = queuedRunner([
		{ok: true, output: JSON.stringify([BAD])},
		{ok: true, output: JSON.stringify([GOOD])},
	]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner);
	t.true(result.ok);
	t.is(result.attempts, 2);
	t.is(runner.calls, 2);
	// The second prompt is the correction prompt.
	t.true(runner.prompts[1]?.includes('## Correction required'));
	t.true(runner.prompts[1]?.includes('severity'));
});

test('stops after maxAttempts when it never validates', async t => {
	const runner = queuedRunner([{ok: true, output: JSON.stringify([BAD])}]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner);
	t.false(result.ok);
	t.is(result.attempts, 2);
	t.is(runner.calls, 2);
	t.true(result.errors.some(e => e.field === 'severity'));
});

test('honours a custom maxAttempts', async t => {
	const runner = queuedRunner([{ok: true, output: JSON.stringify([BAD])}]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner, {
		maxAttempts: 3,
	});
	t.is(result.attempts, 3);
	t.is(runner.calls, 3);
});

test('does not retry a process-level failure', async t => {
	const runner = queuedRunner([
		{ok: false, output: '', error: 'nanocoder not on PATH'},
	]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner);
	t.false(result.ok);
	t.is(result.attempts, 1);
	t.is(runner.calls, 1);
	t.is(result.runError, 'nanocoder not on PATH');
});

test('a single attempt disables retries', async t => {
	const runner = queuedRunner([{ok: true, output: JSON.stringify([BAD])}]);
	const result = await runAuditWithAutoFix('prompt', MODEL, runner, {
		maxAttempts: 1,
	});
	t.is(result.attempts, 1);
	t.is(runner.calls, 1);
});

function failed(overrides: Partial<AuditResult> = {}): AuditResult {
	return {
		ok: false,
		findings: [],
		errors: [{index: 0, field: 'severity', message: 'bad severity'}],
		raw: JSON.stringify([BAD]),
		...overrides,
	};
}

test('buildAutoFixPrompt includes the original prompt and the error report', t => {
	const prompt = buildAutoFixPrompt('ORIGINAL', failed());
	t.true(prompt.includes('ORIGINAL'));
	t.true(prompt.includes('## Correction required'));
	t.true(prompt.includes('finding[0].severity: bad severity'));
	t.true(prompt.includes('Your previous JSON array was:'));
});

test('buildAutoFixPrompt omits the previous array when none was found', t => {
	const prompt = buildAutoFixPrompt('ORIGINAL', failed({raw: 'no array here'}));
	t.false(prompt.includes('Your previous JSON array was:'));
	t.true(prompt.includes('## Correction required'));
});

test('buildAutoFixPrompt renders document-level errors without an index', t => {
	const prompt = buildAutoFixPrompt(
		'ORIGINAL',
		failed({
			errors: [{index: -1, field: 'document', message: 'no array found'}],
			raw: '',
		}),
	);
	t.true(prompt.includes('- document: no array found'));
	t.false(prompt.includes('finding[-1]'));
});
