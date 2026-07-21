#!/usr/bin/env node

/**
 * Sentinel CLI entry point.
 *
 *   sentinel init   scaffold a configuration repo
 *   sentinel run    perform an audit pass (not yet implemented)
 *
 * The init command's logic lives in ./init; this file is the interactive glue
 * (prompting, printing) and is excluded from coverage.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {parseConfig} from './config/parse.js';
import type {ModelConfig} from './config/types.js';
import {parseInitArgs} from './init/args.js';
import {scaffold} from './init/scaffold.js';
import type {InitOptions} from './init/types.js';
import {ghIssueClient} from './issues/gh-client.js';
import {nanocoderRunner} from './orchestrator/nanocoder-runner.js';
import {ensureTargets} from './run/clone.js';
import {renderPreview} from './run/preview.js';
import {renderReport} from './run/report.js';
import {runFromConfig, runLocal} from './run/run.js';
import {fsPackLoader, fsRepoFiles} from './run/sources.js';

const USAGE = `sentinel <command>

Commands:
  init    Scaffold a Sentinel configuration into the current repository
  run     Perform an audit pass against a rule pack and a repository

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

Local (calibration): audit one pack against one repo, write findings to
Markdown, and file nothing.

Options:
  --rule-pack <path>    Local mode: the rule pack to run
  --repo <path>         Local mode: the repository directory to audit
  --output <path>       Write the Markdown report here (default stdout)
  --config <path>       Path to sentinel.yaml (default ./sentinel.yaml)
  --packs-dir <path>    Rule packs directory (default ./rule-packs)
  --workspace <path>    Where target repos are checked out (default .)
  --config-repo <o/n>   Config repo, for routing (default $GITHUB_REPOSITORY)
  --provider <name>     Local mode model provider (default ollama)
  --model <id>          Local mode model id (default llama3.1:70b)
  --dry-run             Audit but file no issues`;

function flagMap(argv: string[]): Map<string, string | true> {
	const map = new Map<string, string | true>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token || !token.startsWith('--')) {
			continue;
		}
		const body = token.slice(2);
		const eq = body.indexOf('=');
		if (eq !== -1) {
			map.set(body.slice(0, eq), body.slice(eq + 1));
			continue;
		}
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			map.set(body, next);
			i++;
		} else {
			map.set(body, true);
		}
	}
	return map;
}

function flagStr(
	flags: Map<string, string | true>,
	key: string,
): string | undefined {
	const value = flags.get(key);
	return typeof value === 'string' ? value : undefined;
}

function writeReport(markdown: string, output: string | undefined): void {
	if (output) {
		writeFileSync(output, markdown);
		console.log(`Wrote report to ${output}`);
	} else {
		console.log(markdown);
	}
}

async function runRun(argv: string[]): Promise<number> {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(RUN_USAGE);
		return 0;
	}
	const flags = flagMap(argv);
	const output = flagStr(flags, 'output');

	// Local calibration mode.
	const rulePack = flagStr(flags, 'rule-pack');
	const repo = flagStr(flags, 'repo');
	if (rulePack && repo) {
		const model: ModelConfig = {
			provider: flagStr(flags, 'provider') ?? 'ollama',
			model: flagStr(flags, 'model') ?? 'llama3.1:70b',
		};
		const localConfigDir = flagStr(flags, 'config-dir');
		const outcome = await runLocal(
			rulePack,
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
	const parsed = parseConfig(readFileSync(configPath, 'utf8'));
	if (!parsed.valid || !parsed.config) {
		for (const error of parsed.errors) {
			console.error(`config error — ${error.field}: ${error.message}`);
		}
		return 1;
	}

	const dryRun = flags.get('dry-run') === true;
	const workspace = flagStr(flags, 'workspace') ?? '.';

	// Clone any target repos not already present in the workspace.
	if (flags.get('no-clone') !== true) {
		const repos = parsed.config.targets
			.map(target => target.repo)
			.filter((repo): repo is string => Boolean(repo));
		const ensured = ensureTargets(repos, workspace);
		for (const repo of ensured.cloned) {
			console.log(`cloned ${repo}`);
		}
		for (const {repo, error} of ensured.errors) {
			console.error(`clone failed for ${repo}: ${error}`);
		}
	}

	// The client is available whenever a token is present — a dry run uses it to
	// read existing issues for the preview, a live run to file.
	const hasToken = Boolean(process.env.GITHUB_TOKEN);
	const report = await runFromConfig(
		parsed.config,
		{
			runner: nanocoderRunner,
			files: fsRepoFiles,
			packs: fsPackLoader,
			client: hasToken ? ghIssueClient : undefined,
			now: new Date().toISOString(),
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
			dryRun,
		},
	);

	// Dry run with a token renders the grouped preview; otherwise the plain
	// findings report.
	const markdown =
		dryRun && report.previews.length > 0
			? renderPreview(report.previews)
			: renderReport(report.outcome);
	writeReport(markdown, output);

	if (report.filed) {
		for (const {repo: repoName, result} of report.reconciled) {
			console.log(
				`${repoName}: filed ${result.created.length}, touched ${result.touched}, resolved ${result.resolved}`,
			);
		}
	} else if (dryRun) {
		console.log('Dry run — no issues filed.');
	} else {
		console.log('No GITHUB_TOKEN — no issues filed.');
	}
	return 0;
}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;

	switch (command) {
		case 'init':
			return runInit(rest);
		case 'run':
			return runRun(rest);
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
