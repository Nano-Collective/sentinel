/**
 * Run one rule pack against one repository's gathered files: build the prompt,
 * run the audit with the auto-fix loop, and map the result into a PackOutcome.
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

	const result = await runAuditWithAutoFix(prompt, model, runner, options);

	return {
		pack: pack.manifest.name,
		version: pack.manifest.version,
		findings: result.findings,
		attempts: result.attempts,
		ok: result.ok,
		errors: result.errors,
		runError: result.runError,
	};
}
