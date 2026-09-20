/**
 * Real filesystem implementations of RepoFiles and PackLoader. Paths come from
 * the operator's own config repo and the repositories they chose to audit, not
 * untrusted input, so the fs reads are annotated nosemgrep.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	type Stats,
	statSync,
} from 'node:fs';
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

/** A path that could not be read, and the reason it was skipped. */
interface SkippedPath {
	path: string;
	reason: string;
}

function reasonFor(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Report skipped paths on stderr. Skipping one file is the right answer;
 * skipping it *quietly* is not. A pack that reports nothing because it never
 * read the file looks exactly like a pack that read it and found it clean, so
 * every omission says so in the run log.
 */
function warnSkipped(skipped: SkippedPath[]): void {
	for (const {path, reason} of skipped) {
		console.warn(`skipped ${path}: ${reason}`);
	}
}

/**
 * Recursively list files under root, skipping noise directories.
 *
 * Every filesystem call here is guarded. A repository is a shape Sentinel does
 * not control — a dangling symlink, a permission-denied entry, a file deleted
 * between the walk and the stat — and `runFromConfig` audits every target in
 * one process. An unguarded throw is not one bad file; it is every target after
 * that file going unaudited, with no run record written to say so.
 */
function walkFiles(root: string): {files: string[]; skipped: SkippedPath[]} {
	const files: string[] = [];
	const skipped: SkippedPath[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop() as string;
		let entries: string[];
		try {
			entries = readdirSync(dir); // nosemgrep
		} catch (error) {
			skipped.push({path: dir, reason: reasonFor(error)});
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			let stats: Stats;
			try {
				stats = statSync(full); // nosemgrep
			} catch (error) {
				skipped.push({path: full, reason: reasonFor(error)});
				continue;
			}
			if (stats.isDirectory()) {
				if (!IGNORED_DIRS.has(entry)) {
					stack.push(full);
				}
			} else if (stats.isFile()) {
				files.push(full);
			}
		}
	}
	return {files, skipped};
}

function toPosix(path: string): string {
	return path.split(sep).join('/');
}

/** Read repository files and single files from the local filesystem. */
export const fsRepoFiles: RepoFiles = {
	async read(repoDir: string, patterns: string[]): Promise<SourceFile[]> {
		const files: SourceFile[] = [];
		const walked = walkFiles(repoDir);
		for (const full of walked.files) {
			const relativePath = toPosix(relative(repoDir, full));
			if (
				patterns.length > 0 &&
				!patterns.some(pattern => matchesGlob(pattern, relativePath))
			) {
				continue;
			}
			// The walk stat'd this path, but the read happens later and the tree
			// can move underneath it. Both calls are guarded together: whether the
			// file went away or was never readable, the answer is the same.
			try {
				if (statSync(full).size > MAX_FILE_BYTES) {
					continue;
				}
				files.push({path: relativePath, content: readFileSync(full, 'utf8')}); // nosemgrep
			} catch (error) {
				walked.skipped.push({path: full, reason: reasonFor(error)});
			}
		}
		warnSkipped(walked.skipped);
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
		const walked = walkFiles(packsDir);
		warnSkipped(walked.skipped);
		for (const full of walked.files) {
			const relativePath = toPosix(relative(packsDir, full));
			if (!isEnabledPackPath(relativePath)) {
				continue;
			}
			let text: string;
			try {
				text = readFileSync(full, 'utf8'); // nosemgrep
			} catch (error) {
				// A pack that cannot be read is a pack that did not run, which is
				// the one thing the loader must never report as silence. It takes
				// the same route as a pack that failed to parse.
				result.errors.push({
					file: relativePath,
					errors: [
						{
							field: 'document',
							message: `could not be read: ${reasonFor(error)}`,
						},
					],
				});
				continue;
			}
			const parsed = parseRulePack(text);
			if (parsed.valid && parsed.pack) {
				result.packs.push(parsed.pack);
			} else {
				result.errors.push({file: relativePath, errors: parsed.errors});
			}
		}
		return result;
	},
};
