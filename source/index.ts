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
export {findingHash} from './dedup/hash.js';
export {readMarker, readMisses, upsertMarker} from './dedup/markers.js';
export {
	planReconciliation,
	type ReconcileOptions,
	type ReconcilePlan,
	SUPPRESSION_LABELS,
} from './dedup/plan.js';
export {
	type ReconcileResult,
	reconcileFindings,
} from './dedup/reconcile.js';
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
	meetsSeverityThreshold,
	SEVERITIES,
	severityRank,
} from './findings/types.js';
export type {
	ValidationError,
	ValidationResult,
} from './findings/validate.js';
export {validateFindings} from './findings/validate.js';
export {buildIssueBody, buildIssueTitle} from './issues/body.js';
export {
	buildIssueContent,
	fileFindings,
	qualifyingFindings,
	targetRepoFor,
} from './issues/file.js';
export {
	buildGhCloseArgs,
	buildGhEditArgs,
	buildGhIssueArgs,
	buildGhListArgs,
	ghIssueClient,
	parseIssueList,
	parseIssueUrl,
} from './issues/gh-client.js';
export type {
	CreatedIssue,
	CreateIssueParams,
	ExistingIssue,
	FiledIssue,
	FilingContext,
	FilingError,
	FilingResult,
	GitHubClient,
	IssueContent,
	IssueQueryClient,
	ReconcileClient,
} from './issues/types.js';
export {runAudit} from './orchestrator/audit.js';
export {
	type AutoFixOptions,
	type AutoFixResult,
	buildAutoFixPrompt,
	runAuditWithAutoFix,
} from './orchestrator/auto-fix.js';
export {extractJsonArray} from './orchestrator/extract.js';
export {
	buildNanocoderArgs,
	nanocoderRunner,
	resolveModelId,
} from './orchestrator/nanocoder-runner.js';
export type {
	AuditResult,
	ModelRunner,
	ModelRunResult,
	RunnerOptions,
} from './orchestrator/types.js';
export {buildAuditPrompt} from './prompt/build.js';
export type {PromptInput, PromptResult, SourceFile} from './prompt/types.js';
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
