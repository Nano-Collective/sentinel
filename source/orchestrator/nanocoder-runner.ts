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
 * The environment for the Nanocoder spawn. When a config dir is given, point
 * Nanocoder at it via NANOCODER_CONFIG_DIR so it loads the config repo's
 * `agents.config.json` regardless of the audited-repo working directory.
 */
export function buildNanocoderEnv(
	base: NodeJS.ProcessEnv,
	configDir?: string,
): NodeJS.ProcessEnv {
	if (!configDir) {
		return base;
	}
	return {...base, NANOCODER_CONFIG_DIR: configDir};
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
				env: buildNanocoderEnv(process.env, options.configDir),
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
