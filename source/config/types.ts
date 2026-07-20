/**
 * The `sentinel.yaml` configuration model. There is one configuration per
 * install: one file, one workflow, one schedule (see
 * docs/configuration/index.md). Keys are snake_case on disk and normalised to
 * camelCase here.
 */

import type {Severity} from '../findings/types.js';

/** A repository (or pattern) to audit, with the packs assigned to it. */
export interface Target {
	/** A single `owner/name` repository. Mutually exclusive with `pattern`. */
	repo?: string;
	/** A glob over `owner/name` repositories. Mutually exclusive with `repo`. */
	pattern?: string;
	/** The rule pack names to run against this target. */
	rulePacks: string[];
}

/** An optional cloud fallback, used only when the primary model struggles. */
export interface ModelFallback {
	provider: string;
	model: string;
	/** Name of the Actions secret holding the endpoint key. */
	endpointSecret?: string;
}

/** Which Nanocoder provider and model to run. Local-first by default. */
export interface ModelConfig {
	provider: string;
	model: string;
	fallback?: ModelFallback;
}

/** Controls how findings are filed as issues. */
export interface IssuesConfig {
	/** Label applied to every filed issue. */
	label: string;
	/** GitHub login to assign filed issues to, or null. */
	assignee: string | null;
	/** File on the config repo instead of the audited repo. */
	aggregateToConfigRepo: boolean;
}

/** The validated, normalised `sentinel.yaml`. */
export interface SentinelConfig {
	targets: Target[];
	/** Cron expression (UTC) for the scheduled run. */
	schedule: string;
	/** The filing floor: findings below this severity do not open issues. */
	severityThreshold: Severity;
	model: ModelConfig;
	issues: IssuesConfig;
}

/** One systematic-noise exemption in a per-repo override. */
export interface Suppression {
	/** The rule (pack/pattern) to suppress. Optional if `paths` is given. */
	rule?: string;
	/** Glob patterns the suppression applies to. Optional if `rule` is given. */
	paths: string[];
	/** Why the exemption exists. */
	reason: string;
}

/**
 * The opt-in `sentinel.yaml` placed in an audited repo — the most specific
 * suppression layer (see docs/findings/index.md#suppression).
 */
export interface RepoOverride {
	/** Optional per-repo override of the org severity threshold. */
	severityThreshold?: Severity;
	/** Systematic-noise exemptions for this repo. */
	suppress: Suppression[];
}

/** A single reason a config file failed to parse or validate. */
export interface ConfigError {
	/** The offending field path, or 'document' for structural errors. */
	field: string;
	message: string;
}

/** The outcome of parsing `sentinel.yaml`. */
export interface ConfigResult {
	valid: boolean;
	config: SentinelConfig | null;
	errors: ConfigError[];
}

/** The outcome of parsing a per-repo override. */
export interface RepoOverrideResult {
	valid: boolean;
	override: RepoOverride | null;
	errors: ConfigError[];
}
