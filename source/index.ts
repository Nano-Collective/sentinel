/**
 * Public library API for @nanocollective/sentinel.
 *
 * The same package is both the scaffolder (`sentinel init`), the workflow
 * runtime (`sentinel run`), and a library. This module is the library surface.
 */

export {parseConfig} from './config/parse.js';
export {parseRepoOverride} from './config/repo-override.js';
export type {
	ConfigError,
	ConfigResult,
	IssuesConfig,
	ModelConfig,
	ModelFallback,
	RepoOverride,
	RepoOverrideResult,
	SentinelConfig,
	Suppression,
	Target,
} from './config/types.js';
export type {
	Confidence,
	Finding,
	LineRange,
	Severity,
} from './findings/types.js';
export {
	CONFIDENCES,
	isConfidence,
	isSeverity,
	SEVERITIES,
} from './findings/types.js';
export type {
	ValidationError,
	ValidationResult,
} from './findings/validate.js';
export {validateFindings} from './findings/validate.js';
export type {DependencyResult} from './rule-packs/dependencies.js';
export {resolveDependencies} from './rule-packs/dependencies.js';
export {
	globToRegExp,
	matchesAppliesTo,
	matchesGlob,
} from './rule-packs/glob.js';
export {parseRulePack, splitFrontmatter} from './rule-packs/parse.js';
export type {
	AppliesTo,
	ParseResult,
	RulePack,
	RulePackError,
	RulePackManifest,
} from './rule-packs/types.js';
