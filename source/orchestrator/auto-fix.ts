/**
 * The auto-fix loop. When an audit pass produces output that fails validation,
 * re-run the model with the structured error report appended, up to a bounded
 * number of attempts (see docs/workflow/index.md#validation). Only validation
 * failures are retried — a process-level failure (nanocoder missing, timeout)
 * will not be fixed by feeding back an error report, so the loop stops there.
 */

import type {ModelConfig} from '../config/types.js';
import type {ValidationError} from '../findings/validate.js';
import {runAudit} from './audit.js';
import {extractJsonArray} from './extract.js';
import type {AuditResult, ModelRunner, RunnerOptions} from './types.js';

/** Options for the auto-fix loop. */
export interface AutoFixOptions extends RunnerOptions {
	/** Total attempts, including the first. Clamped to at least 1. Default 2. */
	maxAttempts?: number;
}

/** An audit result annotated with how many attempts it took. */
export interface AutoFixResult extends AuditResult {
	/** Number of model runs performed (1 = succeeded or failed on first try). */
	attempts: number;
}

function formatErrors(errors: ValidationError[]): string {
	return errors
		.map(error => {
			const where =
				error.index >= 0
					? `finding[${error.index}].${error.field}`
					: error.field;
			return `- ${where}: ${error.message}`;
		})
		.join('\n');
}

/**
 * Build the follow-up prompt: the original audit prompt plus a correction
 * section listing every validation problem and, when available, the malformed
 * array the model returned.
 */
export function buildAutoFixPrompt(
	originalPrompt: string,
	previous: AuditResult,
): string {
	const parts = [
		originalPrompt,
		'',
		'---',
		'',
		'## Correction required',
		'',
		'Your previous response did not produce a valid findings array. Fix these problems:',
		'',
		formatErrors(previous.errors),
	];

	const previousArray = extractJsonArray(previous.raw);
	if (previousArray !== null) {
		parts.push('', 'Your previous JSON array was:', previousArray);
	}

	parts.push(
		'',
		'Return ONLY a corrected JSON array that resolves every problem above.',
	);
	return parts.join('\n');
}

/**
 * Run an audit pass with the auto-fix retry loop. Returns the first valid
 * result, or the last failed result once attempts are exhausted.
 */
export async function runAuditWithAutoFix(
	prompt: string,
	model: ModelConfig,
	runner: ModelRunner,
	options: AutoFixOptions = {},
): Promise<AutoFixResult> {
	const maxAttempts = Math.max(1, options.maxAttempts ?? 2);

	let result = await runAudit(prompt, model, runner, options);
	let attempts = 1;

	while (!result.ok && !result.runError && attempts < maxAttempts) {
		const fixPrompt = buildAutoFixPrompt(prompt, result);
		result = await runAudit(fixPrompt, model, runner, options);
		attempts++;
	}

	return {...result, attempts};
}
