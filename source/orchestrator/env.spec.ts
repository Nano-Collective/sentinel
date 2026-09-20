import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	modelEnvNames,
	passthroughNames,
	placeholderNames,
	scopeEnv,
} from './env.js';

console.log('\norchestrator/env.spec.ts');

let counter = 0;
function freshDir(): string {
	counter++;
	const dir = join(tmpdir(), `sentinel-env-${process.pid}-${counter}`);
	mkdirSync(dir, {recursive: true});
	return dir;
}

function writeConfig(dir: string, contents: unknown): void {
	writeFileSync(
		join(dir, 'agents.config.json'),
		typeof contents === 'string' ? contents : JSON.stringify(contents),
	);
}

test('placeholderNames collects every ${VAR} reference, deduplicated', t => {
	const names = placeholderNames(
		'{"apiKey":"${MY_KEY}","baseUrl":"${MY_HOST}/v1","other":"${MY_KEY}"}',
	);
	t.deepEqual(names.sort(), ['MY_HOST', 'MY_KEY']);
});

test('placeholderNames ignores text that is not a placeholder', t => {
	t.deepEqual(
		placeholderNames('{"apiKey":"sk-literal-key","x":"$NOT_BRACED"}'),
		[],
	);
});

test('scopeEnv keeps the essentials and drops everything else', t => {
	const scoped = scopeEnv(
		{
			PATH: '/bin',
			HOME: '/home/runner',
			GH_TOKEN: 'ghp_secret',
			GITHUB_TOKEN: 'ghp_secret',
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
			NPM_TOKEN: 'npm_secret',
			AWS_SECRET_ACCESS_KEY: 'aws',
		},
		[],
	);
	t.deepEqual(scoped, {PATH: '/bin', HOME: '/home/runner'});
});

test('scopeEnv keeps the names it is told to allow', t => {
	const scoped = scopeEnv(
		{PATH: '/bin', SENTINEL_MODEL_KEY: 'sk-abc', GH_TOKEN: 'ghp_secret'},
		['SENTINEL_MODEL_KEY'],
	);
	t.is(scoped.SENTINEL_MODEL_KEY, 'sk-abc');
	t.is(scoped.GH_TOKEN, undefined);
});

test('scopeEnv matches names case-insensitively, preserving the original key', t => {
	const scoped = scopeEnv({Path: 'C:\\bin', GH_TOKEN: 'ghp_secret'}, []);
	t.deepEqual(scoped, {Path: 'C:\\bin'});
});

test('scopeEnv drops variables explicitly set to undefined', t => {
	const scoped = scopeEnv({PATH: '/bin', HOME: undefined}, []);
	t.deepEqual(scoped, {PATH: '/bin'});
});

test('modelEnvNames derives the operator model credential from their config', t => {
	const dir = freshDir();
	try {
		writeConfig(dir, {
			nanocoder: {
				providers: [
					{
						name: 'cloud',
						baseUrl: 'https://api.example.com/v1',
						apiKey: '${SENTINEL_MODEL_KEY}',
					},
				],
			},
		});
		t.deepEqual(modelEnvNames(dir), ['SENTINEL_MODEL_KEY']);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('modelEnvNames returns nothing for a missing config dir or file', t => {
	t.deepEqual(modelEnvNames(undefined), []);
	t.deepEqual(modelEnvNames(join(tmpdir(), 'sentinel-env-does-not-exist')), []);
});

test('modelEnvNames reads placeholders from a config JSON.parse would reject', t => {
	const dir = freshDir();
	try {
		// Scanned as text on purpose. A config with a comment or a trailing comma
		// is Nanocoder's problem to report; refusing to see the credential name in
		// it here would silently strip the key and fail the run somewhere else.
		writeConfig(dir, '{\n  // the key\n  "apiKey": "${MY_KEY}",\n}');
		t.deepEqual(modelEnvNames(dir), ['MY_KEY']);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('passthroughNames reads the comma-separated escape hatch', t => {
	t.deepEqual(
		passthroughNames({SENTINEL_PASSTHROUGH_ENV: 'OPENAI_API_KEY, OPENAI_ORG'}),
		['OPENAI_API_KEY', 'OPENAI_ORG'],
	);
	t.deepEqual(passthroughNames({}), []);
	t.deepEqual(passthroughNames({SENTINEL_PASSTHROUGH_ENV: ' , '}), []);
});
