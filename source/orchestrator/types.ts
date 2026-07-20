/**
 * Orchestration types. The audit logic depends on a {@link ModelRunner}
 * interface rather than spawning a process directly, so the parse/validate
 * pipeline stays unit-testable with a fake runner. The real runner
 * (nanocoder-runner.ts) is the only part that touches a child process.
 */

import type {ModelConfig} from '../config/types.js';
import type {Finding} from '../findings/types.js';
import type {ValidationError} from '../findings/validate.js';

/** Per-invocation runner options. */
export interface RunnerOptions {
	/** Working directory for the run (the cloned repo). */
	cwd?: string;
	/** Hard timeout for the model process, in milliseconds. */
	timeoutMs?: number;
	/** Use the configured cloud fallback model instead of the primary. */
	useFallback?: boolean;
}

/** The raw outcome of invoking a model. */
export interface ModelRunResult {
	/** True when the process ran and exited cleanly. */
	ok: boolean;
	/** The model's raw text output (a full agent transcript, typically). */
	output: string;
	/** A process-level error (spawn failure, non-zero exit, timeout). */
	error?: string;
}

/** Runs a prompt against a model and returns its raw output. */
export interface ModelRunner {
	run(
		prompt: string,
		model: ModelConfig,
		options?: RunnerOptions,
	): Promise<ModelRunResult>;
}

/** The outcome of one audit pass: one rule pack against one repository. */
export interface AuditResult {
	/** True when the runner succeeded and the findings validated. */
	ok: boolean;
	/** The validated findings, in the camelCase model. Empty on failure. */
	findings: Finding[];
	/** Validation errors, for the auto-fix loop. Empty when ok. */
	errors: ValidationError[];
	/** The model's raw output, retained for logging and dry-run previews. */
	raw: string;
	/** Set when the model process itself failed (no output to validate). */
	runError?: string;
}
