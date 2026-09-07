/**
 * Run one rule pack against one repository's gathered files: build the prompt,
 * run the audit with the auto-fix loop, and map the result into a PackOutcome.
 * The pass is timed and its tokens counted so `sentinel estimate` has real
 * figures to calibrate against.
 */

import type {ModelConfig} from '../config/types.js';
import {applySeverityWeighting} from '../findings/weighting.js';
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

	// The pack's word is law on severity. The weighting reaches the model in the
	// prompt, but a prompt is a request — this is what makes it authoritative,
	// and it is applied after validation so an accurate finding is never
	// discarded over a severity we already know the right answer to.
	const {findings, overrides} = applySeverityWeighting(result.findings, pack);

	return {
		pack: pack.manifest.name,
		version: pack.manifest.version,
		findings,
		severityOverrides: overrides,
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

/**
 * The outcome of a pack that had nothing to audit — an incremental pass in
 * which no file the pack applies to changed.
 *
 * Deliberately not a model call with an empty file list. Beyond the wasted
 * request, asking a model to audit nothing invites it to answer with something.
 * It counts as `ok`: the pack ran to completion and found nothing, which is a
 * different claim from a pass that errored, and the cache may only advance on
 * the former.
 */
export function skippedPackOutcome(pack: RulePack): PackOutcome {
	return {
		pack: pack.manifest.name,
		version: pack.manifest.version,
		findings: [],
		severityOverrides: [],
		attempts: 0,
		ok: true,
		errors: [],
		usage: {durationMs: 0, promptTokens: 0, outputTokens: 0},
	};
}
