/**
 * Write the file plan to disk. Refuses to overwrite existing files unless
 * `force` is set, so re-running init never clobbers a user's edited config.
 * Tested against a temp directory.
 */

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {planInit} from './plan.js';
import type {InitOptions} from './types.js';

/** What a scaffold run wrote and what it left alone. */
export interface ScaffoldResult {
	written: string[];
	skipped: string[];
}

/**
 * Scaffold a Sentinel config into `dir`. Existing files are skipped unless
 * `force` is true.
 */
export function scaffold(
	options: InitOptions,
	dir: string,
	force = false,
): ScaffoldResult {
	const result: ScaffoldResult = {written: [], skipped: []};

	for (const file of planInit(options)) {
		const fullPath = join(dir, file.path);
		if (existsSync(fullPath) && !force) {
			result.skipped.push(file.path);
			continue;
		}
		mkdirSync(dirname(fullPath), {recursive: true}); // nosemgrep
		writeFileSync(fullPath, file.content); // nosemgrep
		result.written.push(file.path);
	}

	return result;
}
