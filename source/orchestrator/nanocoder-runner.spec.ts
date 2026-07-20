import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import {buildNanocoderArgs, resolveModelId} from './nanocoder-runner.js';

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

test('buildNanocoderArgs mirrors the collective invocation', t => {
	const args = buildNanocoderArgs('the prompt', MODEL);
	t.deepEqual(args, [
		'run',
		'the prompt',
		'--mode',
		'yolo',
		'--model',
		'llama3.1:70b',
		'--trust-directory',
	]);
});

test('buildNanocoderArgs uses the fallback model when opted in', t => {
	const args = buildNanocoderArgs('p', MODEL, {useFallback: true});
	t.is(args[args.indexOf('--model') + 1], 'gpt-x');
});
