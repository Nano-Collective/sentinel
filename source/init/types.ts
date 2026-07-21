/**
 * Types for `sentinel init`, the scaffolder. The resolved options drive pure
 * content generation (templates.ts) and a file plan (plan.ts); the writer
 * (scaffold.ts) puts them on disk.
 */

import type {Severity} from '../findings/types.js';

/** The fully-resolved options an init run scaffolds from. */
export interface InitOptions {
	/** Nanocoder model provider (ollama, lmstudio, a cloud provider, …). */
	provider: string;
	/** Model identifier for that provider. */
	model: string;
	/** Cron schedule (UTC) for the audit workflow. */
	schedule: string;
	/** Repositories to seed `targets` with, as owner/name. */
	targets: string[];
	/** Filing threshold to seed the config with. */
	severityThreshold: Severity;
	/** Label applied to filed issues. */
	label: string;
}

/** Defaults applied to anything the user does not supply. */
export const DEFAULT_INIT_OPTIONS: InitOptions = {
	provider: 'ollama',
	model: 'llama3.1:70b',
	schedule: '0 6 * * *',
	targets: [],
	severityThreshold: 'medium',
	label: 'sentinel',
};

/** One file the scaffolder will write, as a repo-relative path and content. */
export interface ScaffoldFile {
	path: string;
	content: string;
}
