#!/usr/bin/env node

/**
 * Sentinel CLI entry point.
 *
 * Two commands are planned for v1 (see docs/cli/index.md):
 *   sentinel init   scaffold a configuration repo
 *   sentinel run    perform an audit pass
 *
 * Both are stubbed here; the implementations land as the project is built.
 */

const USAGE = `sentinel <command>

Commands:
  init    Scaffold a Sentinel configuration into the current repository
  run     Perform an audit pass against a rule pack and a repository

Run 'sentinel <command> --help' for command-specific options.`;

function main(argv: string[]): number {
	const [command] = argv;

	switch (command) {
		case 'init':
			console.log('sentinel init is not yet implemented.');
			return 0;
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

process.exit(main(process.argv.slice(2)));
