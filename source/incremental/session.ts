/**
 * One run's view of the incremental cache: what the last pass recorded, and
 * what this pass should record. The CLI reads the file, hands the contents in,
 * and writes back whatever the run accumulated.
 *
 * A session is only created when a cache path is configured. `runFromConfig`
 * without one behaves exactly as it did before incremental scanning existed,
 * which is what keeps `sentinel run` in a plain checkout unchanged.
 */

import type {RulePack} from '../rule-packs/types.js';
import {lookup, record} from './cache.js';
import {dependencyHash, type GitProbe, packBodyHash} from './decide.js';
import type {IncrementalCache, PackCacheEntry} from './types.js';

/** The mutable per-run cache session. */
export class CacheSession {
	/** The cache as it was read, unchanged for the life of the run. */
	readonly cache: IncrementalCache;
	readonly probe: GitProbe;
	private next: IncrementalCache;

	constructor(cache: IncrementalCache, probe: GitProbe) {
		this.cache = cache;
		this.probe = probe;
		this.next = cache;
	}

	/** The entry the last successful pass left for this repo and pack. */
	entryFor(repo: string, pack: string): PackCacheEntry | undefined {
		return lookup(this.cache, repo, pack);
	}

	/**
	 * Record that `pack` completed a pass over `repo`.
	 *
	 * The commit is read now rather than at the start of the run, and a
	 * repository whose HEAD cannot be read records nothing at all — with no
	 * commit there is nothing a later run could diff against, and inventing one
	 * would licence skipping files on a boundary that means nothing.
	 */
	recordPass(
		repo: string,
		repoDir: string,
		pack: RulePack,
		dependencies: RulePack[],
	): void {
		const sha = this.probe.head(repoDir);
		if (sha === null) {
			return;
		}
		this.next = record(this.next, repo, {
			pack: pack.manifest.name,
			packVersion: pack.manifest.version,
			bodyHash: packBodyHash(pack),
			dependencyHash: dependencyHash(dependencies),
			sha,
		});
	}

	/** The cache to write back after the run. */
	result(): IncrementalCache {
		return this.next;
	}
}
