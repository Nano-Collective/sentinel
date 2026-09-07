/**
 * The `sentinel run` orchestrator. Drives the whole engine over a config:
 * load packs, resolve each target's packs (+depends_on), gather the repo's
 * files, audit each pack, then either reconcile findings into issues (Actions
 * path) or leave the outcome for a Markdown report (local / dry-run path).
 *
 * All I/O is injected (RepoFiles, PackLoader, ModelRunner, ReconcileClient) so
 * the orchestration is testable end-to-end with fakes.
 */

import {join} from 'node:path';
import {parseRepoOverride} from '../config/repo-override.js';
import type {RepoOverride, SentinelConfig} from '../config/types.js';
import {type ReconcileResult, reconcileFindings} from '../dedup/reconcile.js';
import {emptyScope} from '../dedup/scope.js';
import type {Finding} from '../findings/types.js';
import {
	decidePackScope,
	type FullReason,
	type PackScanPlan,
} from '../incremental/decide.js';
import type {CacheSession} from '../incremental/session.js';
import {targetRepoFor} from '../issues/file.js';
import type {FilingContext, ReconcileClient} from '../issues/types.js';
import type {AutoFixOptions} from '../orchestrator/auto-fix.js';
import type {ModelRunner} from '../orchestrator/types.js';
import {resolveDependencies} from '../rule-packs/dependencies.js';
import {parseRulePack} from '../rule-packs/parse.js';
import type {RulePack} from '../rule-packs/types.js';
import {auditPack} from './audit.js';
import type {PrepareResult} from './clone.js';
import {expandTargets} from './expand.js';
import {
	type PackFailure,
	type PreviewEntry,
	previewReconciliation,
} from './preview.js';
import type {RepoLister} from './repo-lister.js';
import {selectPacks, unionPatterns} from './select.js';
import type {
	FullPassNote,
	PackLoadError,
	PackLoader,
	PackOutcome,
	RepoFiles,
	RepoOutcome,
	RunOutcome,
} from './types.js';

/** Injected dependencies for a run. */
export interface RunDeps {
	runner: ModelRunner;
	files: RepoFiles;
	packs: PackLoader;
	/** Present only when filing issues (the Actions path). */
	client?: ReconcileClient;
	/** Lists an owner's repos to expand pattern targets. */
	repoLister?: RepoLister;
	/** Ensures a target repo is checked out; omit to assume repos are present. */
	cloneRepo?: (repo: string, dir: string) => Promise<PrepareResult>;
	/**
	 * The incremental cache for this run. Omit it and every pack reads
	 * everything, which is the pre-incremental behaviour and the default.
	 */
	cache?: CacheSession;
	/** ISO timestamp for deterministic reconciliation. */
	now: string;
}

/** Options for a config-driven run. */
export interface RunConfigOptions {
	/** Directory the target repos are checked out under. */
	workspaceDir: string;
	/** The config repo's rule-packs directory. */
	packsDir: string;
	/** The config repo's owner/name, for issue routing and footers. */
	configRepo?: string;
	/**
	 * The config repo directory holding nanocoder's agents.config.json. Passed
	 * to the runner as NANOCODER_CONFIG_DIR so provider wiring lives there.
	 */
	configDir?: string;
	/** Audit but file nothing. */
	dryRun?: boolean;
	autoFix?: AutoFixOptions;
	resolveAfterMisses?: number;
	/** Re-audit everything, ignoring the cache. */
	full?: boolean;
}

/** Everything a config-driven run produced. */
export interface RunReport {
	outcome: RunOutcome;
	/** Live-run reconciliation results (empty on a dry run). */
	reconciled: {repo: string; result: ReconcileResult}[];
	/** Dry-run previews (empty on a live run). */
	previews: PreviewEntry[];
	packLoadErrors: PackLoadError[];
	/** Target-expansion and clone failures. */
	targetErrors: string[];
	/** True if issues were filed (client present and not a dry run). */
	filed: boolean;
}

/**
 * The packs one pack depends on, transitively, in the order the resolver puts
 * them in the prompt. The root is dropped: a pack is not its own dependency,
 * and folding it in would make `dependencyHash` shadow `bodyHash` and lose the
 * distinction the run report draws between the two.
 */
function dependenciesOf(available: RulePack[], pack: RulePack): RulePack[] {
	const chain = resolveDependencies(available, pack.manifest.name);
	const byName = new Map(available.map(entry => [entry.manifest.name, entry]));
	const dependencies: RulePack[] = [];
	for (const name of chain.order) {
		if (name === pack.manifest.name) {
			continue;
		}
		const dependency = byName.get(name);
		if (dependency) {
			dependencies.push(dependency);
		}
	}
	return dependencies;
}

async function readOverride(
	files: RepoFiles,
	repoDir: string,
): Promise<RepoOverride | undefined> {
	const text = await files.readText(join(repoDir, 'sentinel.yaml'));
	if (text === null) {
		return undefined;
	}
	const parsed = parseRepoOverride(text);
	return parsed.valid && parsed.override ? parsed.override : undefined;
}

/** Run an audit driven by a Sentinel config. */
export async function runFromConfig(
	config: SentinelConfig,
	deps: RunDeps,
	options: RunConfigOptions,
): Promise<RunReport> {
	const loaded = await deps.packs.load(options.packsDir);

	const repos: RepoOutcome[] = [];
	const reconciled: {repo: string; result: ReconcileResult}[] = [];
	const previews: PreviewEntry[] = [];
	const filing = Boolean(deps.client) && !options.dryRun;

	// Expand explicit and pattern targets into concrete repositories.
	const expanded = await expandTargets(config.targets, deps.repoLister);
	const targetErrors = [...expanded.errors];

	for (const target of expanded.targets) {
		const repoName = target.repo;
		const repoDir = join(options.workspaceDir, repoName);

		// Clone the repo if a cloner is provided and it is not already present.
		if (deps.cloneRepo) {
			const prepared = await deps.cloneRepo(repoName, repoDir);
			if (!prepared.ok) {
				targetErrors.push(
					`could not check out ${repoName}: ${prepared.error ?? 'clone failed'}`,
				);
				continue;
			}
		}

		const {
			packs: resolvedPacks,
			missing: missingPacks,
			unresolved: unresolvedPacks,
		} = selectPacks(loaded.packs, target.rulePacks);

		const runnerOptions: AutoFixOptions = {
			...options.autoFix,
			cwd: repoDir,
			configDir: options.configDir,
		};

		// Decide each pack's scope before reading anything, so a pack that may skip
		// files reads only what it needs. Packs reading everything still share a
		// single union read, exactly as before.
		const plans = new Map<string, PackScanPlan>();
		for (const pack of resolvedPacks) {
			plans.set(
				pack.manifest.name,
				deps.cache
					? decidePackScope({
							pack,
							repoDir,
							cached: deps.cache.entryFor(repoName, pack.manifest.name),
							dependencies: dependenciesOf(resolvedPacks, pack),
							incremental: target.incremental,
							forced: options.full === true,
							probe: deps.cache.probe,
						})
					: {kind: 'full', reason: 'incremental-disabled'},
			);
		}

		const fullPacks = resolvedPacks.filter(
			pack => plans.get(pack.manifest.name)?.kind === 'full',
		);
		const files =
			fullPacks.length > 0
				? await deps.files.read(repoDir, unionPatterns(fullPacks))
				: [];

		const packOutcomes: PackOutcome[] = [];
		const scope = emptyScope();
		for (const pack of resolvedPacks) {
			const plan = plans.get(pack.manifest.name);
			const packFiles =
				plan?.kind === 'partial'
					? await deps.files.read(repoDir, plan.paths)
					: files;
			if (plan?.kind === 'partial') {
				scope.scannedByPack.set(
					pack.manifest.name,
					new Set(packFiles.map(file => file.path)),
				);
			} else {
				scope.fullPacks.add(pack.manifest.name);
			}
			const outcome = await auditPack(
				pack,
				{repoName, files: packFiles},
				config.model,
				deps.runner,
				runnerOptions,
			);
			packOutcomes.push(outcome);
			// Only a pass that actually completed may advance the cache. Recording a
			// commit for a pack whose audit errored would let the next run skip files
			// on the strength of a pass that never happened.
			if (outcome.ok && deps.cache) {
				deps.cache.recordPass(
					repoName,
					repoDir,
					pack,
					dependenciesOf(resolvedPacks, pack),
				);
			}
		}

		// Only interesting when the operator asked for incremental scanning: a
		// full pass they did not request needs no explanation.
		const fullPasses: FullPassNote[] = target.incremental
			? [...plans.entries()]
					.filter(([, plan]) => plan.kind === 'full')
					.map(([pack, plan]) => ({
						pack,
						reason: (plan as {reason: FullReason}).reason,
					}))
			: [];

		repos.push({
			repo: repoName,
			packs: packOutcomes,
			missingPacks,
			unresolvedPacks,
			...(fullPasses.length > 0 ? {fullPasses} : {}),
		});

		if (!deps.client) {
			continue;
		}
		const findings = packOutcomes.flatMap(outcome => outcome.findings);
		// Which pack produced each finding, and what each pack read. Both are
		// known here and nowhere downstream: `findings` is flat by the time it
		// reaches reconciliation, and the flattening is what loses the pack.
		const packOfFinding = new Map<Finding, string>();
		for (const outcome of packOutcomes) {
			for (const finding of outcome.findings) {
				packOfFinding.set(finding, outcome.pack);
			}
		}
		const override = await readOverride(deps.files, repoDir);
		const context: FilingContext = {
			auditedRepo: repoName,
			configRepo: options.configRepo,
		};

		if (filing) {
			const result = await reconcileFindings(
				findings,
				config,
				deps.client,
				context,
				deps.now,
				{
					resolveAfterMisses: options.resolveAfterMisses,
					scope,
					packOfFinding,
				},
				override,
			);
			reconciled.push({repo: repoName, result});
		} else {
			// Dry run: read existing issues and compute the preview, mutating nothing.
			const existing = await deps.client.listIssues({
				repo: targetRepoFor(config, context),
				label: config.issues.label,
			});
			const preview = previewReconciliation(
				findings,
				config,
				existing,
				override,
				{
					resolveAfterMisses: options.resolveAfterMisses,
					scope,
				},
			);
			const failedPacks: PackFailure[] = packOutcomes
				.filter(outcome => !outcome.ok)
				.map(outcome => ({
					pack: outcome.pack,
					reason: outcome.runError
						? `run error: ${outcome.runError}`
						: `malformed output after ${outcome.attempts} attempt(s) (${outcome.errors.length} validation error(s))`,
				}));
			// Pack-selection problems travel with the preview too. A dry run that
			// omitted them would report "none" in every group for a repo whose
			// packs never ran, which reads as clean rather than as not audited.
			previews.push({
				repo: repoName,
				preview,
				failedPacks,
				missingPacks,
				unresolvedPacks,
			});
		}
	}

	return {
		outcome: {repos},
		reconciled,
		previews,
		packLoadErrors: loaded.errors,
		targetErrors,
		filed: filing,
	};
}

/** Dependencies for an ad-hoc local run of a single pack. */
export interface RunLocalDeps {
	runner: ModelRunner;
	files: RepoFiles;
}

/**
 * Run one or more packs against a repository directory for off-cycle
 * calibration. Never files issues. Throws if a pack file is missing or invalid.
 *
 * Packs are named explicitly here, so unlike the config-driven path this does
 * not resolve `depends_on` — the caller lists what it wants run, in order.
 */
export async function runLocal(
	packPaths: string[],
	repoDir: string,
	model: SentinelConfig['model'],
	deps: RunLocalDeps,
	options: AutoFixOptions = {},
): Promise<RunOutcome> {
	const packOutcomes: PackOutcome[] = [];

	for (const packPath of packPaths) {
		const text = await deps.files.readText(packPath);
		if (text === null) {
			throw new Error(`rule pack not found: ${packPath}`);
		}
		const parsed = parseRulePack(text);
		if (!parsed.valid || !parsed.pack) {
			const detail = parsed.errors
				.map(error => `${error.field}: ${error.message}`)
				.join('; ');
			throw new Error(`invalid rule pack ${packPath}: ${detail}`);
		}

		const pack = parsed.pack;
		const files = await deps.files.read(repoDir, pack.manifest.appliesTo.paths);
		packOutcomes.push(
			await auditPack(pack, {repoName: repoDir, files}, model, deps.runner, {
				...options,
				cwd: repoDir,
			}),
		);
	}

	return {
		repos: [
			{
				repo: repoDir,
				packs: packOutcomes,
				missingPacks: [],
				unresolvedPacks: [],
			},
		],
	};
}
