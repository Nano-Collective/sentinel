/**
 * The incremental cache: what each pack last audited, and at which commit.
 *
 * Committed to the configuration repository beside the run records — the same
 * posture, and for the same reason. There is no database, no server and no
 * state anywhere but your own repository, so a cache that cannot be read is a
 * cache that gets rebuilt by reading everything, never one that silently
 * narrows an audit.
 */

/** The cache schema version. Bumped whenever an entry's meaning changes. */
export const CACHE_VERSION = 1;

/** What one pack had audited on one repository, as of one commit. */
export interface PackCacheEntry {
	/** The rule pack's name. */
	pack: string;
	/** The pack's manifest version when it last completed a pass. */
	packVersion: string;
	/**
	 * A hash of the pack's audit body. Version alone is not enough: a pack whose
	 * prompt was edited without a version bump asks a different question, and
	 * every file has to be re-read to answer it.
	 */
	bodyHash: string;
	/**
	 * A combined hash of the bodies of every pack this one depends on. A
	 * dependency's body is part of this pack's prompt, so editing a shared
	 * `rust-general` pack changes the question every dependent asks — and every
	 * dependent has to re-read everything to answer it. Kept apart from
	 * `bodyHash` so the run report can say which of the two actually changed.
	 */
	dependencyHash: string;
	/**
	 * The commit the repository was at when this pack last completed a pass. The
	 * next run diffs against it to decide what changed.
	 */
	sha: string;
}

/** Everything cached for one repository. */
export interface RepoCacheEntry {
	repo: string;
	packs: PackCacheEntry[];
}

/** The whole cache, as committed. */
export interface IncrementalCache {
	version: number;
	repos: RepoCacheEntry[];
}

/** An empty cache — what a first run, or an unreadable file, starts from. */
export function emptyCache(): IncrementalCache {
	return {version: CACHE_VERSION, repos: []};
}
