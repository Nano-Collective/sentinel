/**
 * Types for `sentinel run`, the audit runtime. The orchestrator (run.ts)
 * depends on these injectable sources so the whole pipeline is testable with
 * fakes; the real filesystem/gh/nanocoder implementations live at the edges.
 */

import type {Finding} from '../findings/types.js';
import type {ValidationError} from '../findings/validate.js';
import type {SourceFile} from '../prompt/types.js';
import type {RulePack, RulePackError} from '../rule-packs/types.js';

/** Reads repository source files and single files from disk (injectable). */
export interface RepoFiles {
	/** Read files under `repoDir` matching any of the glob patterns. An empty
	 * pattern list means the whole repository. */
	read(repoDir: string, patterns: string[]): Promise<SourceFile[]>;
	/** Read a single file's text, or null if it does not exist. */
	readText(path: string): Promise<string | null>;
}

/** A pack that failed to parse while loading the rule-packs directory. */
export interface PackLoadError {
	file: string;
	errors: RulePackError[];
}

/** The result of loading the rule-packs directory. */
export interface LoadedPacks {
	packs: RulePack[];
	errors: PackLoadError[];
}

/** Loads and parses the enabled rule packs from a directory (injectable). */
export interface PackLoader {
	load(packsDir: string): Promise<LoadedPacks>;
}

/** The outcome of one pack's audit pass against one repository. */
export interface PackOutcome {
	pack: string;
	version: string;
	findings: Finding[];
	attempts: number;
	ok: boolean;
	errors: ValidationError[];
	runError?: string;
	/** The raw model output, kept for diagnosing a failed audit. */
	raw?: string;
}

/** All pack outcomes for one repository. */
export interface RepoOutcome {
	repo: string;
	packs: PackOutcome[];
	/** Packs named by the target but missing from the rule-packs directory. */
	missingPacks: string[];
}

/** Everything one run produced. */
export interface RunOutcome {
	repos: RepoOutcome[];
}
