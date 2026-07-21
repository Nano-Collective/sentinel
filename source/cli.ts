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

import {createInterface} from 'node:readline/promises';
import {parseInitArgs} from './init/args.js';
import {scaffold} from './init/scaffold.js';
import type {InitOptions} from './init/types.js';

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

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;

	switch (command) {
		case 'init':
			return runInit(rest);
		case 'run':
			console.log('sentinel run is not yet implemented.');
			return 0;
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
