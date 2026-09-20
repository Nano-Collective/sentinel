import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import {
	buildNanocoderArgs,
	buildNanocoderEnv,
	parseNanocoderReport,
	resolveModelId,
	resolveProvider,
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
		'--provider',
		'ollama',
		'--model',
		'llama3.1:70b',
		'--trust-directory',
		'--json',
	]);
});

test('buildNanocoderArgs sends the configured provider', t => {
	// model.provider was validated and then never passed, so the run used
	// whichever provider Nanocoder chose for itself.
	const args = buildNanocoderArgs('p', {provider: 'lmstudio', model: 'qwen'});
	t.is(args[args.indexOf('--provider') + 1], 'lmstudio');
});

test('buildNanocoderArgs switches provider and model together on fallback', t => {
	const args = buildNanocoderArgs('p', MODEL, {useFallback: true});
	t.is(args[args.indexOf('--model') + 1], 'gpt-x');
	t.is(args[args.indexOf('--provider') + 1], 'openai');
});

test('resolveProvider falls back to the primary when none is configured', t => {
	t.is(resolveProvider({provider: 'ollama', model: 'm'}, true), 'ollama');
});

test('buildNanocoderEnv sets NANOCODER_CONFIG_DIR when a config dir is given', t => {
	const env = buildNanocoderEnv({PATH: '/bin'}, '/cfg');
	t.is(env.NANOCODER_CONFIG_DIR, '/cfg');
	t.is(env.PATH, '/bin');
});

test('buildNanocoderEnv keeps the essentials without a config dir', t => {
	t.deepEqual(buildNanocoderEnv({PATH: '/bin'}), {PATH: '/bin'});
});

test('buildNanocoderEnv withholds the GitHub token from the model subprocess', t => {
	// The credential the audit holds to file issues, which Nanocoder has no use
	// for: it reads code and returns findings, and gh-client spends the token in
	// its own spawn afterwards.
	const env = buildNanocoderEnv(
		{
			PATH: '/bin',
			GH_TOKEN: 'ghp_secret',
			GITHUB_TOKEN: 'ghp_secret',
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
			NPM_TOKEN: 'npm_secret',
		},
		'/cfg',
	);
	t.is(env.GH_TOKEN, undefined);
	t.is(env.GITHUB_TOKEN, undefined);
	t.is(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
	t.is(env.NPM_TOKEN, undefined);
});

test('buildNanocoderEnv honours the passthrough escape hatch', t => {
	const env = buildNanocoderEnv({
		PATH: '/bin',
		OPENAI_API_KEY: 'sk-abc',
		GH_TOKEN: 'ghp_secret',
		SENTINEL_PASSTHROUGH_ENV: 'OPENAI_API_KEY',
	});
	t.is(env.OPENAI_API_KEY, 'sk-abc');
	t.is(env.GH_TOKEN, undefined);
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
