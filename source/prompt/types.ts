/**
 * Inputs and output for audit prompt templating. The builder is pure: the
 * orchestrator reads files from disk and passes them in, so the same code path
 * serves both the Actions run and a local `sentinel run` (see
 * docs/workflow/index.md#execution-model).
 */

import type {RulePack} from '../rule-packs/types.js';

/** A repository file, with its POSIX-style repo-relative path. */
export interface SourceFile {
	path: string;
	content: string;
}

/** Everything needed to build one audit prompt for one pack against one repo. */
export interface PromptInput {
	/** The rule pack whose body is the audit instructions. */
	pack: RulePack;
	/** Candidate source files; scoped down by the pack's applies_to. */
	files: SourceFile[];
	/** The audited repository, e.g. "my-org/my-program". */
	repoName?: string;
	/** Additional reference files the pack should read (Anchor.toml, etc.). */
	context?: SourceFile[];
	/** Free-text per-repo context. */
	repoNotes?: string;
}

/** The assembled prompt plus which files it did and did not include. */
export interface PromptResult {
	prompt: string;
	/** Paths included after applies_to scoping. */
	includedFiles: string[];
	/** Paths excluded by applies_to scoping. */
	skippedFiles: string[];
}
