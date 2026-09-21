/**
 * The real {@link ModelRunner}: spawns Nanocoder non-interactively and captures
 * its output. Matches the collective's invocation
 * (`nanocoder run "<prompt>" --mode yolo --model <model> --trust-directory`);
 * Nanocoder auto-enables its Ink-free `--plain` runtime off a TTY, so a single
 * direct spawn works locally and on GitHub Actions runners.
 *
 * Unlike ContentForest, Sentinel captures stdout (the agent transcript) so the
 * findings array can be extracted, rather than inheriting stdio.
 */

import {type SpawnSyncReturns, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import type {ModelConfig} from '../config/types.js';
import {modelEnvNames, passthroughNames, scopeEnv} from './env.js';
import type {ModelRunner, ModelRunResult, RunnerOptions} from './types.js';

const DEFAULT_TIMEOUT_MS = 600_000;

/** Resolve the model id to pass to Nanocoder, honouring the fallback flag. */
export function resolveModelId(
	model: ModelConfig,
	useFallback: boolean,
): string {
	if (useFallback && model.fallback) {
		return model.fallback.model;
	}
	return model.model;
}

/**
 * Resolve the provider, honouring the fallback flag. Paired with the model id:
 * falling back means switching both, and a fallback model id sent to the
 * primary provider is not a model that provider has.
 */
export function resolveProvider(
	model: ModelConfig,
	useFallback: boolean,
): string {
	if (useFallback && model.fallback) {
		return model.fallback.provider;
	}
	return model.provider;
}

/**
 * Build the Nanocoder argv for a run. Pure and tested; the spawn itself is not.
 */
export function buildNanocoderArgs(
	promptFile: string,
	model: ModelConfig,
	options: RunnerOptions = {},
): string[] {
	const useFallback = options.useFallback ?? false;
	return [
		'run',
		// The prompt goes through a file, never argv. Linux caps a single
		// argument at MAX_ARG_STRLEN (32 pages = 131072 bytes) regardless of the
		// far larger ARG_MAX total, and execve fails with E2BIG before the
		// process starts. A prompt carries every file the pack matched, so this
		// is reached by any repository of ordinary size — 314 KiB for one of
		// Sentinel's own packs. macOS has no equivalent per-argument cap, which
		// is what let it go unnoticed: it works locally and cannot spawn in CI.
		'--prompt-file',
		promptFile,
		'--mode',
		'yolo',
		// `model.provider` was configured, validated and then never sent, so
		// every run used whichever provider Nanocoder picked for itself — and a
		// model id resolved against a provider that was not the configured one.
		'--provider',
		resolveProvider(model, useFallback),
		'--model',
		resolveModelId(model, useFallback),
		'--trust-directory',
		// Emit one complete JSON report to stdout instead of a streamed,
		// last-token-lossy human transcript.
		'--json',
	];
}

/**
 * Parse Nanocoder's `--json` report from stdout into a ModelRunResult. The
 * report is `{kind, exitCode, finalText, ...}`; on a non-success kind the
 * message is surfaced as the error. Non-JSON stdout is handed through as-is so
 * the extractor can still try.
 */
export function parseNanocoderReport(stdout: string): ModelRunResult {
	let report: unknown;
	try {
		report = JSON.parse(stdout);
	} catch {
		return {ok: true, output: stdout};
	}
	if (typeof report !== 'object' || report === null) {
		return {ok: true, output: stdout};
	}

	const {kind, finalText, message} = report as {
		kind?: string;
		finalText?: unknown;
		message?: unknown;
	};
	const output = typeof finalText === 'string' ? finalText : '';
	if (kind === 'success') {
		return {ok: true, output};
	}
	return {
		ok: false,
		output,
		error:
			typeof message === 'string'
				? message
				: `nanocoder: ${kind ?? 'unknown result'}`,
	};
}

/**
 * The environment for the Nanocoder spawn.
 *
 * Scoped, not inherited. Nanocoder reads code from a repository Sentinel does
 * not control and returns findings; it has no use for the org-wide GitHub token
 * the audit holds to file issues, which `issues/gh-client.ts` spends in its own
 * spawn afterwards. See `./env.ts` for why this is an allowlist.
 *
 * When a config dir is given, Nanocoder is pointed at it via
 * NANOCODER_CONFIG_DIR so the provider wiring lives in the config repo
 * regardless of the audited-repo working directory — and that same file names
 * the credentials the child is allowed to keep.
 */
export function buildNanocoderEnv(
	base: NodeJS.ProcessEnv,
	configDir?: string,
): NodeJS.ProcessEnv {
	const scoped = scopeEnv(base, [
		...modelEnvNames(configDir),
		...passthroughNames(base),
	]);
	if (!configDir) {
		return scoped;
	}
	scoped.NANOCODER_CONFIG_DIR = configDir;
	return scoped;
}

/* c8 ignore start -- spawns a real process; not exercised in unit tests. */
/**
 * Whether the installed Nanocoder understands `--prompt-file`.
 *
 * Detected from `--help` rather than compared against a version, because a
 * capability is the thing actually depended on and `--help` is Nanocoder's
 * deliberate fast path — it prints static text and exits before loading the
 * app. Probed once per process.
 *
 * Without this the failure is silent in the worst way: an older Nanocoder does
 * not reject an unknown flag, it folds it into the prompt. The model is then
 * asked to audit the literal text `--prompt-file /tmp/…`, answers something
 * unusable, and the run reports malformed output with no hint of why.
 */
let promptFileSupport: boolean | undefined;

function supportsPromptFile(): boolean {
	if (promptFileSupport === undefined) {
		const help = spawnSync('nanocoder', ['--help'], {
			encoding: 'utf8',
			timeout: 30_000,
		});
		promptFileSupport = (help.stdout ?? '').includes('--prompt-file');
	}
	return promptFileSupport;
}

export const nanocoderRunner: ModelRunner = {
	async run(
		prompt: string,
		model: ModelConfig,
		options: RunnerOptions = {},
	): Promise<ModelRunResult> {
		if (!supportsPromptFile()) {
			return {
				ok: false,
				output: '',
				error:
					'the installed nanocoder does not support --prompt-file. Sentinel sends the prompt through a file because Linux refuses to spawn a process with an argument over 128 KiB, which any repository of ordinary size exceeds. Upgrade it: npm install -g @nanocollective/nanocoder@latest',
			};
		}

		// Written next to nothing else and removed on the way out. The prompt
		// contains the audited repository's source, so it does not belong in the
		// cwd of the repo being audited, nor anywhere it could outlive the run.
		const promptFile = join(
			mkdtempSync(join(tmpdir(), 'sentinel-prompt-')),
			'prompt.txt',
		);
		let result: SpawnSyncReturns<string>;
		try {
			writeFileSync(promptFile, prompt, 'utf8');
			result = spawnSync(
				'nanocoder',
				buildNanocoderArgs(promptFile, model, options),
				{
					cwd: options.cwd,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
					timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
					env: buildNanocoderEnv(process.env, options.configDir),
					maxBuffer: 64 * 1024 * 1024,
				},
			);
		} finally {
			rmSync(dirname(promptFile), {recursive: true, force: true});
		}

		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				return {
					ok: false,
					output: '',
					error:
						'`nanocoder` is not on PATH. Install it (npm i -g @nanocollective/nanocoder).',
				};
			}
			if (code === 'E2BIG') {
				return {
					ok: false,
					output: '',
					error: `the argument list was too long to spawn nanocoder (${Math.round(prompt.length / 1024)} KiB prompt). Sentinel passes the prompt through a file, so this means the installed nanocoder is too old to support --prompt-file — upgrade it (npm install -g @nanocollective/nanocoder@latest).`,
				};
			}
			if (code === 'ETIMEDOUT') {
				return {
					ok: false,
					output: result.stdout ?? '',
					error: 'nanocoder timed out',
				};
			}
			return {
				ok: false,
				output: result.stdout ?? '',
				error: String(result.error),
			};
		}

		const stdout = result.stdout ?? '';
		if (stdout.trim().length === 0) {
			return {
				ok: false,
				output: '',
				error:
					`nanocoder produced no output (status ${result.status}): ${result.stderr ?? ''}`.trim(),
			};
		}

		// nanocoder may exit non-zero for an error kind but still emit the JSON
		// report, so parse regardless of status.
		return parseNanocoderReport(stdout);
	},
};
/* c8 ignore stop */
