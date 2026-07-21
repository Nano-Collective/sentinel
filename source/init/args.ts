/**
 * Parse the `sentinel init` flags into resolved options. Pure and tested; the
 * interactive prompting for anything omitted lives in the CLI glue.
 */

import {isSeverity} from '../findings/types.js';
import {DEFAULT_INIT_OPTIONS, type InitOptions} from './types.js';

/** The parsed result of `sentinel init` arguments. */
export interface ParsedInitArgs {
	options: InitOptions;
	/** Directory to scaffold into. */
	dir: string;
	/** Overwrite existing files. */
	force: boolean;
	/** Run non-interactively, accepting defaults for anything not supplied. */
	yes: boolean;
	/** Validation problems (e.g. an unknown severity). */
	errors: string[];
}

/** Split `--flag value` and `--flag=value` into a key/value map (+ booleans). */
function tokenize(argv: string[]): Map<string, string | true> {
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

function asString(value: string | true | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Parse `sentinel init` argv (excluding the `init` command word). */
export function parseInitArgs(argv: string[]): ParsedInitArgs {
	const flags = tokenize(argv);
	const errors: string[] = [];

	const options: InitOptions = {...DEFAULT_INIT_OPTIONS};

	const provider = asString(flags.get('provider'));
	if (provider) {
		options.provider = provider;
	}
	const model = asString(flags.get('model'));
	if (model) {
		options.model = model;
	}
	const schedule = asString(flags.get('schedule'));
	if (schedule) {
		options.schedule = schedule;
	}
	const label = asString(flags.get('label'));
	if (label) {
		options.label = label;
	}

	const targets = asString(flags.get('targets'));
	if (targets) {
		options.targets = targets
			.split(',')
			.map(target => target.trim())
			.filter(target => target.length > 0);
	}

	const threshold = asString(flags.get('severity-threshold'));
	if (threshold !== undefined) {
		if (isSeverity(threshold)) {
			options.severityThreshold = threshold;
		} else {
			errors.push(
				`unknown severity-threshold "${threshold}" (use low, medium, high, or critical)`,
			);
		}
	}

	return {
		options,
		dir: asString(flags.get('dir')) ?? '.',
		force: flags.get('force') === true || flags.get('force') === 'true',
		yes: flags.get('yes') === true || flags.get('yes') === 'true',
		errors,
	};
}
