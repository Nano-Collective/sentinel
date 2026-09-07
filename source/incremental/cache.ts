/**
 * Reading and updating the incremental cache. Pure: the CLI owns the file.
 */

import {
	CACHE_VERSION,
	emptyCache,
	type IncrementalCache,
	type PackCacheEntry,
} from './types.js';

/**
 * Parse a cache file's contents. Anything unreadable, malformed, or written by
 * a schema this build does not know becomes an empty cache — which forces a
 * full pass everywhere rather than trusting a shape whose meaning has changed.
 * Deliberately silent about the difference: both outcomes are "read everything",
 * and neither can narrow an audit.
 */
export function parseCache(text: string | null): IncrementalCache {
	if (text === null) {
		return emptyCache();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return emptyCache();
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		(parsed as {version?: unknown}).version !== CACHE_VERSION ||
		!Array.isArray((parsed as {repos?: unknown}).repos)
	) {
		return emptyCache();
	}
	return parsed as IncrementalCache;
}

/** The cache entry for one pack on one repository, if there is one. */
export function lookup(
	cache: IncrementalCache,
	repo: string,
	pack: string,
): PackCacheEntry | undefined {
	return cache.repos
		.find(entry => entry.repo === repo)
		?.packs.find(entry => entry.pack === pack);
}

/**
 * Record that a pack completed a pass over `repo` at `sha`.
 *
 * Only ever called for a pass that actually succeeded. A pack whose audit
 * errored or returned malformed findings has not established that anything was
 * examined, and writing a commit for it would let the next run skip files on
 * the strength of a pass that never happened.
 */
export function record(
	cache: IncrementalCache,
	repo: string,
	entry: PackCacheEntry,
): IncrementalCache {
	const repos = cache.repos.map(existing =>
		existing.repo === repo
			? {
					repo,
					packs: [
						...existing.packs.filter(pack => pack.pack !== entry.pack),
						entry,
					],
				}
			: existing,
	);
	if (!repos.some(existing => existing.repo === repo)) {
		repos.push({repo, packs: [entry]});
	}
	return {version: CACHE_VERSION, repos};
}

/** Serialise the cache for committing. */
export function serialiseCache(cache: IncrementalCache): string {
	return `${JSON.stringify(cache, null, 2)}\n`;
}
