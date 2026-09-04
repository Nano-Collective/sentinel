/**
 * Run one rule pack against one repository's gathered files: build the prompt,
 * run the audit with the auto-fix loop, and map the result into a PackOutcome.
 * The pass is timed and its tokens counted so `sentinel estimate` has real
 * figures to calibrate against.
 */

import type {ModelConfig} from '../config/types.js';
import {
	type AutoFixOptions,
	runAuditWithAutoFix,
} from '../orchestrator/auto-fix.js';
import type {ModelRunner} from '../orchestrator/types.js';
import {buildAuditPrompt} from '../prompt/build.js';
import type {SourceFile} from '../prompt/types.js';
import type {RulePack} from '../rule-packs/types.js';
import {tokensFromChars} from './estimate.js';
import type {PackOutcome} from './types.js';

/** The repository material one pack pass audits. */
export interface PackAuditContext {
	repoName?: string;
	files: SourceFile[];
	context?: SourceFile[];
	repoNotes?: string;
}

/** Audit one pack against one repo's files. */
export async function auditPack(
	pack: RulePack,
	context: PackAuditContext,
	model: ModelConfig,
	runner: ModelRunner,
	options: AutoFixOptions = {},
): Promise<PackOutcome> {
	const {prompt} = buildAuditPrompt({
		pack,
		files: context.files,
		repoName: context.repoName,
		context: context.context,
		repoNotes: context.repoNotes,
	});

	const startedAt = Date.now();
	const result = await runAuditWithAutoFix(prompt, model, runner, options);
	const durationMs = Date.now() - startedAt;

	return {
		pack: pack.manifest.name,
		version: pack.manifest.version,
		findings: result.findings,
		attempts: result.attempts,
		ok: result.ok,
		errors: result.errors,
		runError: result.runError,
		raw: result.raw,
		usage: {
			durationMs,
			// Both sides are the real totals across every attempt, not the final
			// one scaled up: a retry resends the prompt plus a correction section,
			// and the output it discards still cost tokens to generate. Counting
			// them keeps calibration honest, since requests includes retries too.
			promptTokens: tokensFromChars(result.promptChars),
			outputTokens: tokensFromChars(result.outputChars),
		},
	};
}
