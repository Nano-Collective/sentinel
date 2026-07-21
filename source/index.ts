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
export {type ParsedInitArgs, parseInitArgs} from './init/args.js';
export {planInit} from './init/plan.js';
export {type ScaffoldResult, scaffold} from './init/scaffold.js';
export {
	configReadme,
	nanocoderConfig,
	sentinelYaml,
	starterPack,
	workflowYaml,
} from './init/templates.js';
export {
	DEFAULT_INIT_OPTIONS,
	type InitOptions,
	type ScaffoldFile,
} from './init/types.js';
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
	buildNanocoderEnv,
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
export {auditPack, type PackAuditContext} from './run/audit.js';
export {
	buildCloneArgs,
	type PrepareResult,
	prepareRepo,
} from './run/clone.js';
export {
	type ExpandResult,
	expandTargets,
	type ResolvedRepoTarget,
} from './run/expand.js';
export {
	type DryRunPreview,
	previewReconciliation,
	renderPreview,
} from './run/preview.js';
export {
	buildRepoListArgs,
	ghRepoLister,
	parseRepoList,
	type RepoLister,
} from './run/repo-lister.js';
export {countFindings, renderReport} from './run/report.js';
export {
	type RunConfigOptions,
	type RunDeps,
	type RunLocalDeps,
	type RunReport,
	runFromConfig,
	runLocal,
} from './run/run.js';
export {isEnabledPackPath, unionPatterns} from './run/select.js';
export {fsPackLoader, fsRepoFiles} from './run/sources.js';
export type {
	LoadedPacks,
	PackLoadError,
	PackLoader,
	PackOutcome,
	RepoFiles,
	RepoOutcome,
	RunOutcome,
} from './run/types.js';
export {
	applyRepoOverride,
	isSuppressed,
	matchesSuppression,
	type OverrideOutcome,
} from './suppression/apply.js';
