/**
 * Run one audit pass — one rule pack against one repository — by invoking a
 * {@link ModelRunner}, extracting the findings array from its output, and
 * validating it. The result carries either validated findings or the structured
 * errors the auto-fix loop (task #5) will feed back to the model.
 */

import type {ModelConfig} from '../config/types.js';
import {validateFindings} from '../findings/validate.js';
import {extractJsonArray} from './extract.js';
import type {AuditResult, ModelRunner, RunnerOptions} from './types.js';

/**
 * Invoke the model on the prompt and return validated findings, or the reason
 * the pass did not produce them.
 */
export async function runAudit(
	prompt: string,
	model: ModelConfig,
	runner: ModelRunner,
	options?: RunnerOptions,
): Promise<AuditResult> {
	const run = await runner.run(prompt, model, options);

	if (!run.ok) {
		return {
			ok: false,
			findings: [],
			errors: [],
			raw: run.output,
			runError: run.error ?? 'model run failed',
		};
	}

	const extracted = extractJsonArray(run.output);
	if (extracted === null) {
		return {
			ok: false,
			findings: [],
			errors: [
				{
					index: -1,
					field: 'document',
					message: 'no JSON array of findings was found in the model output',
				},
			],
			raw: run.output,
		};
	}

	const result = validateFindings(extracted);
	return {
		ok: result.valid,
		findings: result.findings,
		errors: result.errors,
		raw: run.output,
	};
}
