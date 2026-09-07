/**
 * Reading sentinel.yaml off disk and turning every way that can fail into the
 * same reportable shape.
 *
 * This exists as its own module rather than living in the CLI because the read
 * itself was the bug: `parseConfig(readFileSync(configPath, 'utf8'))` threw a
 * raw ENOENT stack trace straight past the `config error —` reporting sitting
 * immediately below it, so the first thing a new user hits — running `sentinel
 * run` outside a configured directory — was a stack trace instead of a
 * sentence. The CLI is excluded from coverage, so a fix left in place there
 * could not be tested; here it can be.
 */

import {parseConfig} from './parse.js';
import type {SentinelConfig} from './types.js';

/** Reads a file's text, or throws. Injected so the failure path is testable. */
export type ConfigReader = (path: string) => string;

/** The outcome of loading a config: the config, or the lines explaining why not. */
export interface ConfigLoadResult {
	config?: SentinelConfig;
	/** Ready-to-print lines. Empty only when `config` is present. */
	errors: string[];
	/**
	 * Set when the file itself could not be read (missing, unreadable, a
	 * directory) as opposed to read-but-invalid. The CLI uses it to add the
	 * "run `sentinel init`" hint, which would be noise on a parse error.
	 */
	unreadable?: boolean;
}

/**
 * Load and parse a Sentinel config, routing a failed read through the same
 * reporting path as a failed parse.
 */
export function loadConfigFrom(
	configPath: string,
	read: ConfigReader,
): ConfigLoadResult {
	let text: string;
	try {
		text = read(configPath);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			errors: [`config error — ${configPath}: ${reason}`],
			unreadable: true,
		};
	}

	const parsed = parseConfig(text);
	if (!parsed.valid || !parsed.config) {
		return {
			errors: parsed.errors.map(
				error => `config error — ${error.field}: ${error.message}`,
			),
		};
	}
	return {config: parsed.config, errors: []};
}
