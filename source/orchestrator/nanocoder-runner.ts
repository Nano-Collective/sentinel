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

import {spawnSync} from 'node:child_process';
import type {ModelConfig} from '../config/types.js';
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
 * Build the Nanocoder argv for a run. Pure and tested; the spawn itself is not.
 */
export function buildNanocoderArgs(
	prompt: string,
	model: ModelConfig,
	options: RunnerOptions = {},
): string[] {
	return [
		'run',
		prompt,
		'--mode',
		'yolo',
		'--model',
		resolveModelId(model, options.useFallback ?? false),
		'--trust-directory',
	];
}

/* c8 ignore start -- spawns a real process; not exercised in unit tests. */
export const nanocoderRunner: ModelRunner = {
	async run(
		prompt: string,
		model: ModelConfig,
		options: RunnerOptions = {},
	): Promise<ModelRunResult> {
		const result = spawnSync(
			'nanocoder',
			buildNanocoderArgs(prompt, model, options),
			{
				cwd: options.cwd,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				env: process.env,
				maxBuffer: 64 * 1024 * 1024,
			},
		);

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

		if (result.status !== 0) {
			return {
				ok: false,
				output: result.stdout ?? '',
				error:
					`nanocoder exited with status ${result.status}: ${result.stderr ?? ''}`.trim(),
			};
		}

		return {ok: true, output: result.stdout ?? ''};
	},
};
/* c8 ignore stop */
