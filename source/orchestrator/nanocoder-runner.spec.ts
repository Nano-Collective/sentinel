import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import {
	buildNanocoderArgs,
	buildNanocoderEnv,
	parseNanocoderReport,
	resolveModelId,
} from './nanocoder-runner.js';

console.log('\norchestrator/nanocoder-runner.spec.ts');

const MODEL: ModelConfig = {
	provider: 'ollama',
	model: 'llama3.1:70b',
	fallback: {provider: 'openai', model: 'gpt-x'},
};

test('resolveModelId returns the primary model by default', t => {
	t.is(resolveModelId(MODEL, false), 'llama3.1:70b');
});

test('resolveModelId returns the fallback model when requested', t => {
	t.is(resolveModelId(MODEL, true), 'gpt-x');
});

test('resolveModelId falls back to primary when no fallback configured', t => {
	t.is(
		resolveModelId({provider: 'ollama', model: 'llama3.1'}, true),
		'llama3.1',
	);
});

test('buildNanocoderArgs mirrors the collective invocation with --json', t => {
	const args = buildNanocoderArgs('the prompt', MODEL);
	t.deepEqual(args, [
		'run',
		'the prompt',
		'--mode',
		'yolo',
		'--model',
		'llama3.1:70b',
		'--trust-directory',
		'--json',
	]);
});

test('buildNanocoderArgs uses the fallback model when opted in', t => {
	const args = buildNanocoderArgs('p', MODEL, {useFallback: true});
	t.is(args[args.indexOf('--model') + 1], 'gpt-x');
});

test('buildNanocoderEnv sets NANOCODER_CONFIG_DIR when a config dir is given', t => {
	const env = buildNanocoderEnv({PATH: '/bin'}, '/cfg');
	t.is(env.NANOCODER_CONFIG_DIR, '/cfg');
	t.is(env.PATH, '/bin');
});

test('buildNanocoderEnv returns the base env unchanged without a config dir', t => {
	const base = {PATH: '/bin'};
	t.is(buildNanocoderEnv(base), base);
});

test('parseNanocoderReport returns finalText on a success report', t => {
	const stdout = JSON.stringify({
		kind: 'success',
		exitCode: 0,
		finalText: '```json\n[{"rule":"x"}]\n```\n<<<SENTINEL_END>>>',
	});
	const result = parseNanocoderReport(stdout);
	t.true(result.ok);
	t.true(result.output.includes('[{"rule":"x"}]'));
});

test('parseNanocoderReport surfaces an error kind as a failure', t => {
	const stdout = JSON.stringify({
		kind: 'error',
		exitCode: 1,
		finalText: '',
		message: 'provider auth failed',
	});
	const result = parseNanocoderReport(stdout);
	t.false(result.ok);
	t.is(result.error, 'provider auth failed');
});

test('parseNanocoderReport falls back to raw text when stdout is not the report', t => {
	const result = parseNanocoderReport('just some text [1,2]');
	t.true(result.ok);
	t.is(result.output, 'just some text [1,2]');
});
