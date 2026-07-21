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
import {targetRepoFor} from '../issues/file.js';
import type {FilingContext, ReconcileClient} from '../issues/types.js';
import type {AutoFixOptions} from '../orchestrator/auto-fix.js';
import type {ModelRunner} from '../orchestrator/types.js';
import {resolveDependencies} from '../rule-packs/dependencies.js';
import {parseRulePack} from '../rule-packs/parse.js';
import type {RulePack} from '../rule-packs/types.js';
import {auditPack} from './audit.js';
import {type DryRunPreview, previewReconciliation} from './preview.js';
import {unionPatterns} from './select.js';
import type {
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
}

/** Everything a config-driven run produced. */
export interface RunReport {
	outcome: RunOutcome;
	/** Live-run reconciliation results (empty on a dry run). */
	reconciled: {repo: string; result: ReconcileResult}[];
	/** Dry-run previews (empty on a live run). */
	previews: {repo: string; preview: DryRunPreview}[];
	packLoadErrors: PackLoadError[];
	/** True if issues were filed (client present and not a dry run). */
	filed: boolean;
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
	const packByName = new Map(
		loaded.packs.map(pack => [pack.manifest.name, pack]),
	);

	const repos: RepoOutcome[] = [];
	const reconciled: {repo: string; result: ReconcileResult}[] = [];
	const previews: {repo: string; preview: DryRunPreview}[] = [];
	const filing = Boolean(deps.client) && !options.dryRun;

	for (const target of config.targets) {
		// Pattern targets need org repo enumeration (a GitHub API concern); v1
		// audits explicit repos.
		if (!target.repo) {
			continue;
		}
		const repoName = target.repo;
		const repoDir = join(options.workspaceDir, repoName);

		const resolvedNames = new Set<string>();
		const missingPacks: string[] = [];
		for (const name of target.rulePacks) {
			if (!packByName.has(name)) {
				missingPacks.push(name);
				continue;
			}
			const resolved = resolveDependencies(loaded.packs, name);
			if (resolved.errors.length > 0) {
				missingPacks.push(name);
				continue;
			}
			for (const resolvedName of resolved.order) {
				resolvedNames.add(resolvedName);
			}
		}

		const resolvedPacks: RulePack[] = [];
		for (const name of resolvedNames) {
			const pack = packByName.get(name);
			if (pack) {
				resolvedPacks.push(pack);
			}
		}

		const files = await deps.files.read(repoDir, unionPatterns(resolvedPacks));

		const runnerOptions: AutoFixOptions = {
			...options.autoFix,
			cwd: repoDir,
			configDir: options.configDir,
		};
		const packOutcomes: PackOutcome[] = [];
		for (const pack of resolvedPacks) {
			packOutcomes.push(
				await auditPack(
					pack,
					{repoName, files},
					config.model,
					deps.runner,
					runnerOptions,
				),
			);
		}

		repos.push({repo: repoName, packs: packOutcomes, missingPacks});

		if (!deps.client) {
			continue;
		}
		const findings = packOutcomes.flatMap(outcome => outcome.findings);
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
				{resolveAfterMisses: options.resolveAfterMisses},
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
				},
			);
			previews.push({repo: repoName, preview});
		}
	}

	return {
		outcome: {repos},
		reconciled,
		previews,
		packLoadErrors: loaded.errors,
		filed: filing,
	};
}

/** Dependencies for an ad-hoc local run of a single pack. */
export interface RunLocalDeps {
	runner: ModelRunner;
	files: RepoFiles;
}

/**
 * Run a single pack against a repository directory for off-cycle calibration.
 * Never files issues. Throws if the pack file is missing or invalid.
 */
export async function runLocal(
	packPath: string,
	repoDir: string,
	model: SentinelConfig['model'],
	deps: RunLocalDeps,
	options: AutoFixOptions = {},
): Promise<RunOutcome> {
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
	const outcome = await auditPack(
		pack,
		{repoName: repoDir, files},
		model,
		deps.runner,
		{...options, cwd: repoDir},
	);

	return {repos: [{repo: repoDir, packs: [outcome], missingPacks: []}]};
}
