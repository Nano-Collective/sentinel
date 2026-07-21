/**
 * Real filesystem implementations of RepoFiles and PackLoader. Paths come from
 * the operator's own config repo and the repositories they chose to audit, not
 * untrusted input, so the fs reads are annotated nosemgrep.
 */

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import type {SourceFile} from '../prompt/types.js';
import {matchesGlob} from '../rule-packs/glob.js';
import {parseRulePack} from '../rule-packs/parse.js';
import {isEnabledPackPath} from './select.js';
import type {LoadedPacks, PackLoader, RepoFiles} from './types.js';

const IGNORED_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'coverage',
	'.next',
	'out',
	'vendor',
	'target',
]);

/** Skip files larger than this — likely generated or binary, and token-heavy. */
const MAX_FILE_BYTES = 512 * 1024;

/** Recursively list files under root, skipping noise directories. */
function walkFiles(root: string): string[] {
	const out: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(dir); // nosemgrep
		} catch {
			/* c8 ignore next 2 -- unreadable directory */
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			const stats = statSync(full); // nosemgrep
			if (stats.isDirectory()) {
				if (!IGNORED_DIRS.has(entry)) {
					stack.push(full);
				}
			} else if (stats.isFile()) {
				out.push(full);
			}
		}
	}
	return out;
}

function toPosix(path: string): string {
	return path.split(sep).join('/');
}

/** Read repository files and single files from the local filesystem. */
export const fsRepoFiles: RepoFiles = {
	async read(repoDir: string, patterns: string[]): Promise<SourceFile[]> {
		const files: SourceFile[] = [];
		for (const full of walkFiles(repoDir)) {
			const relativePath = toPosix(relative(repoDir, full));
			if (
				patterns.length > 0 &&
				!patterns.some(pattern => matchesGlob(pattern, relativePath))
			) {
				continue;
			}
			if (statSync(full).size > MAX_FILE_BYTES) {
				continue;
			}
			files.push({path: relativePath, content: readFileSync(full, 'utf8')}); // nosemgrep
		}
		files.sort((a, b) => a.path.localeCompare(b.path));
		return files;
	},

	async readText(path: string): Promise<string | null> {
		try {
			return readFileSync(path, 'utf8'); // nosemgrep
		} catch {
			return null;
		}
	},
};

/** Load and parse the enabled rule packs from a directory. */
export const fsPackLoader: PackLoader = {
	async load(packsDir: string): Promise<LoadedPacks> {
		const result: LoadedPacks = {packs: [], errors: []};
		if (!existsSync(packsDir)) {
			return result;
		}
		for (const full of walkFiles(packsDir)) {
			const relativePath = toPosix(relative(packsDir, full));
			if (!isEnabledPackPath(relativePath)) {
				continue;
			}
			const parsed = parseRulePack(readFileSync(full, 'utf8')); // nosemgrep
			if (parsed.valid && parsed.pack) {
				result.packs.push(parsed.pack);
			} else {
				result.errors.push({file: relativePath, errors: parsed.errors});
			}
		}
		return result;
	},
};
