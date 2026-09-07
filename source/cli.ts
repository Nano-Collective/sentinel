#!/usr/bin/env node

/**
 * Sentinel CLI entry point.
 *
 *   sentinel init      scaffold a configuration repo
 *   sentinel run       perform an audit pass
 *   sentinel estimate  size an audit before running it
 *
 * The init command's logic lives in ./init; this file is the interactive glue
 * (prompting, printing) and is excluded from coverage.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {flagAll, flagBool, flagStr, parseFlags} from './args/flags.js';
import {loadConfigFrom} from './config/load.js';
import type {ModelConfig, SentinelConfig} from './config/types.js';
import {parseCache, serialiseCache} from './incremental/cache.js';
import {gitProbe} from './incremental/git.js';
import {CacheSession} from './incremental/session.js';
import {parseInitArgs} from './init/args.js';
import {scaffold} from './init/scaffold.js';
import type {InitOptions} from './init/types.js';
import {ghIssueClient} from './issues/gh-client.js';
import {renderDashboard} from './observe/dashboard.js';
import {buildRunRecord, recordFilename} from './observe/record.js';
import type {RunMode, RunRecord} from './observe/types.js';
import {nanocoderRunner} from './orchestrator/nanocoder-runner.js';
import {prepareRepo} from './run/clone.js';
import {estimateRun, renderEstimate} from './run/estimate.js';
import {renderPreview} from './run/preview.js';
import {ghRepoLister} from './run/repo-lister.js';
import {
	hasRunProblems,
	type RunProblems,
	renderFilingLine,
	renderReport,
	renderRunProblems,
} from './run/report.js';
import {runFromConfig, runLocal} from './run/run.js';
import {fsPackLoader, fsRepoFiles} from './run/sources.js';

const USAGE = `sentinel <command>

Commands:
  init      Scaffold a Sentinel configuration into the current repository
  run       Perform an audit pass against a rule pack and a repository
  estimate  Size an audit — requests, tokens, runtime — without running it

Run 'sentinel <command> --help' for command-specific options.`;

const INIT_USAGE = `sentinel init [options]

Scaffold sentinel.yaml, the audit workflow, an empty rule-packs/ directory,
and a disabled starter pack into the current (or given) directory.

Options:
  --provider <name>            Model provider (ollama, lmstudio, a cloud provider)
  --model <id>                 Model identifier
  --schedule <cron>            Cron schedule, UTC (default "0 6 * * *")
  --targets <a/b,c/d>          Comma-separated owner/repo targets
  --severity-threshold <s>     low | medium | high | critical (default medium)
  --label <name>               Issue label (default "sentinel")
  --dir <path>                 Directory to scaffold into (default ".")
  --force                      Overwrite existing files
  --yes                        Non-interactive; accept defaults`;

async function promptMissing(options: InitOptions): Promise<InitOptions> {
	const rl = createInterface({input: process.stdin, output: process.stdout});
	try {
		const ask = async (label: string, current: string): Promise<string> => {
			const answer = (await rl.question(`${label} [${current}]: `)).trim();
			return answer.length > 0 ? answer : current;
		};
		const provider = await ask('Model provider', options.provider);
		const model = await ask('Model', options.model);
		const schedule = await ask('Schedule (cron, UTC)', options.schedule);
		const label = await ask('Issue label', options.label);
		const targetsRaw = await ask(
			'Repositories to audit (comma-separated owner/repo)',
			options.targets.join(','),
		);
		const targets = targetsRaw
			.split(',')
			.map(target => target.trim())
			.filter(target => target.length > 0);
		return {...options, provider, model, schedule, label, targets};
	} finally {
		rl.close();
	}
}

async function runInit(argv: string[]): Promise<number> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(INIT_USAGE);
		return 0;
	}

	const parsed = parseInitArgs(argv);
	if (parsed.errors.length > 0) {
		for (const error of parsed.errors) {
			console.error(`error: ${error}`);
		}
		return 1;
	}

	const interactive = !parsed.yes && Boolean(process.stdin.isTTY);
	const options = interactive
		? await promptMissing(parsed.options)
		: parsed.options;

	const result = scaffold(options, parsed.dir, parsed.force);
	for (const path of result.written) {
		console.log(`  created  ${path}`);
	}
	for (const path of result.skipped) {
		console.log(`  skipped  ${path} (exists; pass --force to overwrite)`);
	}

	console.log(
		'\nNext steps:\n  1. Edit sentinel.yaml — set your real targets and model.\n  2. Write your first rule pack in rule-packs/ (see the disabled example).\n  3. Commit and push. The audit runs on schedule, or dispatch it manually.',
	);
	return 0;
}

const RUN_USAGE = `sentinel run [options]

Config-driven (default): reads sentinel.yaml and audits every target. Files
issues when GITHUB_TOKEN is set and --dry-run is not passed.

Local (calibration): audit one or more packs against one repo, write findings
to Markdown, and file nothing.

Options:
  --rule-pack <path>    Local mode: a rule pack to run. Repeat for several
  --repo <path>         Local mode: the repository directory to audit
  --output <path>       Write the Markdown report here (default stdout)
  --config <path>       Path to sentinel.yaml (default ./sentinel.yaml)
  --packs-dir <path>    Rule packs directory (default ./rule-packs)
  --workspace <path>    Where target repos are checked out (default .)
  --config-repo <o/n>   Config repo, for routing (default $GITHUB_REPOSITORY)
  --provider <name>     Local mode model provider (default ollama)
  --model <id>          Local mode model id (default llama3.1:70b)
  --dry-run             Audit but file no issues
  --full                Re-audit every file, ignoring the incremental cache
  --cache-file <path>   Incremental cache (default ./.sentinel-cache.json)`;

/** Load sentinel.yaml, printing every failure mode through one path. */
function loadConfig(configPath: string): SentinelConfig | null {
	const result = loadConfigFrom(configPath, path => readFileSync(path, 'utf8'));
	for (const error of result.errors) {
		console.error(error);
	}
	if (result.unreadable) {
		console.error(
			'Run `sentinel init` to scaffold one, or pass --config <path>.',
		);
	}
	return result.config ?? null;
}

function writeReport(markdown: string, output: string | undefined): void {
	if (output) {
		writeFileSync(output, markdown);
		console.log(`Wrote report to ${output}`);
	} else {
		console.log(markdown);
	}
}

/**
 * Read the incremental cache. A missing or unreadable file is an empty cache,
 * which makes the run read everything — the safe direction, and the reason this
 * never reports an error: there is nothing for an operator to act on when the
 * outcome is a complete audit.
 */
function readCache(path: string): CacheSession {
	const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
	return new CacheSession(parseCache(text), gitProbe);
}

function writeCache(session: CacheSession, path: string): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, serialiseCache(session.result()));
	console.log(`Wrote incremental cache to ${path}`);
}

function writeRunRecord(record: RunRecord, recordsDir: string): void {
	mkdirSync(recordsDir, {recursive: true});
	const path = join(recordsDir, recordFilename(record.timestamp));
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
	console.log(`Wrote run record to ${path}`);
}

function readRunRecords(recordsDir: string): RunRecord[] {
	const records: RunRecord[] = [];
	if (!existsSync(recordsDir)) {
		return records;
	}
	for (const name of readdirSync(recordsDir)) {
		if (!name.endsWith('.json')) {
			continue;
		}
		try {
			records.push(JSON.parse(readFileSync(join(recordsDir, name), 'utf8')));
		} catch {
			// Skip a malformed record rather than fail the whole read.
		}
	}
	return records;
}

function writeDashboard(recordsDir: string, dashboardDir: string): void {
	const records = readRunRecords(recordsDir);
	mkdirSync(dashboardDir, {recursive: true});
	const path = join(dashboardDir, 'index.html');
	writeFileSync(path, renderDashboard(records));
	console.log(`Wrote dashboard to ${path}`);
}

async function runRun(argv: string[]): Promise<number> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(RUN_USAGE);
		return 0;
	}
	const flags = parseFlags(argv);
	const output = flagStr(flags, 'output');

	// Local calibration mode. `--rule-pack` is repeatable, so several packs can
	// be calibrated against one repository in a single pass.
	const rulePacks = flagAll(flags, 'rule-pack');
	const repo = flagStr(flags, 'repo');
	if (rulePacks.length > 0 && repo) {
		const model: ModelConfig = {
			provider: flagStr(flags, 'provider') ?? 'ollama',
			model: flagStr(flags, 'model') ?? 'llama3.1:70b',
		};
		const localConfigDir = flagStr(flags, 'config-dir');
		const outcome = await runLocal(
			rulePacks,
			repo,
			model,
			{runner: nanocoderRunner, files: fsRepoFiles},
			// Absolute — nanocoder runs with cwd set to the audited repo.
			{configDir: localConfigDir ? resolve(localConfigDir) : undefined},
		);
		writeReport(renderReport(outcome), output);
		return 0;
	}

	// Config-driven mode.
	const configPath = flagStr(flags, 'config') ?? 'sentinel.yaml';
	const config = loadConfig(configPath);
	if (!config) {
		return 1;
	}

	const dryRun = flagBool(flags, 'dry-run');
	const workspace = flagStr(flags, 'workspace') ?? '.';
	const noClone = flagBool(flags, 'no-clone');

	// The cache is only consulted when a target opted in, but it is loaded either
	// way so that a run which is not yet incremental still records where each
	// pack got to. Without that, switching `incremental: true` on would always
	// find an empty cache and read everything anyway.
	//
	// A dry run neither reads nor writes it: a preview must not narrow a later
	// audit, and must not record a pass it did not make.
	const cachePath = flagStr(flags, 'cache-file') ?? '.sentinel-cache.json';
	const cache = dryRun ? undefined : readCache(cachePath);

	// The client is available whenever a token is present — a dry run uses it to
	// read existing issues for the preview, a live run to file.
	const hasToken = Boolean(process.env.GITHUB_TOKEN);
	const now = new Date().toISOString();
	const report = await runFromConfig(
		config,
		{
			runner: nanocoderRunner,
			files: fsRepoFiles,
			packs: fsPackLoader,
			client: hasToken ? ghIssueClient : undefined,
			repoLister: ghRepoLister,
			cloneRepo: noClone ? undefined : prepareRepo,
			cache,
			now,
		},
		{
			workspaceDir: workspace,
			packsDir:
				flagStr(flags, 'packs-dir') ?? join(dirname(configPath), 'rule-packs'),
			// nanocoder's agents.config.json lives beside sentinel.yaml. Absolute —
			// nanocoder runs with cwd set to the audited repo.
			configDir: resolve(flagStr(flags, 'config-dir') ?? dirname(configPath)),
			configRepo:
				flagStr(flags, 'config-repo') ?? process.env.GITHUB_REPOSITORY,
			resolveAfterMisses: flagStr(flags, 'resolve-after-misses')
				? Number(flagStr(flags, 'resolve-after-misses'))
				: undefined,
			dryRun,
			full: flagBool(flags, 'full'),
		},
	);

	if (cache) {
		writeCache(cache, cachePath);
	}

	// Dry run with a token renders the grouped preview; otherwise the plain
	// findings report.
	const body =
		dryRun && report.previews.length > 0
			? renderPreview(report.previews)
			: renderReport(report.outcome);

	// Every problem the run collected goes into the artifact, not just the
	// console — the report is what gets committed, attached to the step summary
	// and read later, and a report that omits them presents a partial audit as a
	// complete one.
	const problems: RunProblems = {
		packLoadErrors: report.packLoadErrors,
		targetErrors: report.targetErrors,
		filingErrors: report.reconciled.map(({repo: repoName, result}) => ({
			repo: repoName,
			errors: result.errors,
		})),
	};
	const problemsSection = renderRunProblems(problems);
	writeReport(
		problemsSection ? `${body}\n\n${problemsSection}\n` : body,
		output,
	);

	for (const {file, errors} of report.packLoadErrors) {
		const detail =
			errors.length > 0
				? errors.map(error => `${error.field}: ${error.message}`).join('; ')
				: 'could not be parsed';
		console.error(
			`rule pack: ${file} failed to load and did not run — ${detail}`,
		);
	}

	for (const error of report.targetErrors) {
		console.error(`target: ${error}`);
	}

	if (report.filed) {
		for (const {repo: repoName, result} of report.reconciled) {
			console.log(renderFilingLine(repoName, result));
			for (const error of result.errors) {
				console.error(`  ${repoName} — ${error}`);
			}
		}
	} else if (dryRun) {
		console.log('Dry run — no issues filed.');
	} else {
		console.log('No GITHUB_TOKEN — no issues filed.');
	}

	// Commit the durable run record and regenerate the static dashboard.
	if (!flagBool(flags, 'no-record')) {
		const mode: RunMode = dryRun
			? 'dry-run'
			: report.filed
				? 'live'
				: 'audit-only';
		const recordsDir = flagStr(flags, 'records-dir') ?? 'runs';
		writeRunRecord(buildRunRecord(report, now, mode), recordsDir);
		if (!flagBool(flags, 'no-dashboard')) {
			writeDashboard(
				recordsDir,
				flagStr(flags, 'dashboard-dir') ?? 'dashboard',
			);
		}
	}

	// The last line the operator reads. A run that ends on the filing summary
	// alone looks successful whatever went wrong earlier in the output.
	if (hasRunProblems(problems)) {
		const counts = [
			report.packLoadErrors.length > 0 &&
				`${report.packLoadErrors.length} rule pack(s) failed to load`,
			report.targetErrors.length > 0 &&
				`${report.targetErrors.length} target(s) could not be audited`,
		].filter((part): part is string => typeof part === 'string');
		console.error(
			`\n⚠️  This audit is incomplete${counts.length > 0 ? `: ${counts.join(', ')}` : ''}. See the Problems section of the report.`,
		);
	}
	return 0;
}

const ESTIMATE_USAGE = `sentinel estimate [options]

Size an audit before running it: repositories, rule packs, files, model
requests, tokens, and wall-clock runtime. Runs no model and files no issues;
--clone is the one flag that writes anything, checking out missing repos.

Figures are calibrated from the committed run records when any exist, so they
sharpen against your own hardware and model. Repos already checked out under
the workspace are measured from their real files; pass --clone to check out the
rest.

Options:
  --config <path>       Path to sentinel.yaml (default ./sentinel.yaml)
  --packs-dir <path>    Rule packs directory (default ./rule-packs)
  --workspace <path>    Where target repos are checked out (default .)
  --records-dir <path>  Run records to calibrate from (default runs)
  --clone               Check out any target repo not already present
  --output <path>       Write the Markdown estimate here (default stdout)`;

async function runEstimate(argv: string[]): Promise<number> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(ESTIMATE_USAGE);
		return 0;
	}
	const flags = parseFlags(argv);

	const configPath = flagStr(flags, 'config') ?? 'sentinel.yaml';
	const config = loadConfig(configPath);
	if (!config) {
		return 1;
	}

	const estimate = await estimateRun(
		config,
		{
			files: fsRepoFiles,
			packs: fsPackLoader,
			repoLister: ghRepoLister,
			cloneRepo: flagBool(flags, 'clone') ? prepareRepo : undefined,
			records: readRunRecords(flagStr(flags, 'records-dir') ?? 'runs'),
		},
		{
			workspaceDir: flagStr(flags, 'workspace') ?? '.',
			packsDir:
				flagStr(flags, 'packs-dir') ?? join(dirname(configPath), 'rule-packs'),
		},
	);

	const output = flagStr(flags, 'output');
	writeReport(renderEstimate(estimate), output);
	// The estimate already renders these as caveats, so repeat them on stderr
	// only when the report went to a file and nobody would otherwise see them.
	if (output) {
		for (const error of estimate.targetErrors) {
			console.error(`target: ${error}`);
		}
	}
	// Deliberately 0 even when targets failed: estimate is advisory, and a
	// partial estimate is still useful — the caveats say what is missing.
	return 0;
}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;

	switch (command) {
		case 'init':
			return runInit(rest);
		case 'run':
			return runRun(rest);
		case 'estimate':
			return runEstimate(rest);
		case undefined:
		case '--help':
		case '-h':
			console.log(USAGE);
			return 0;
		default:
			console.log(`Unknown command: ${command}\n`);
			console.log(USAGE);
			return 1;
	}
}

main(process.argv.slice(2)).then(code => {
	process.exit(code);
});
