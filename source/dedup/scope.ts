/**
 * What a run actually looked at.
 *
 * Reconciliation ages an open issue out when its finding does not recur, and
 * auto-resolves it after enough consecutive misses. That is only sound while
 * every run reads every file: "the finding did not recur" and "the file was
 * not read" are indistinguishable from the planner's side, and they mean
 * opposite things. Absent this module, skipping unchanged files would close
 * real, unfixed findings after `resolveAfterMisses` runs — the tool reporting a
 * vulnerability as fixed because it stopped looking.
 *
 * So the scanned scope travels with the findings. An open issue whose file was
 * not read this run is *held*: neither refreshed nor missed, its counter left
 * exactly where it was.
 *
 * Scope is tracked per **pack**, not per repository, because packs do not read
 * the same files. If pack A skipped `src/db.ts` while pack B read it, an issue
 * A filed against `src/db.ts` was not re-examined even though something looked
 * at the file. Collapsing the two would reintroduce the bug for any repo
 * running more than one pack.
 */

/** The files one run read, per pack. */
export interface ScanScope {
	/**
	 * Pack name → the paths that pack audited this run. Only packs that ran with
	 * a *reduced* file set appear here; a pack that read everything it applies to
	 * belongs in {@link fullPacks}, which needs no path set.
	 */
	scannedByPack: Map<string, Set<string>>;
	/** Packs that read everything they apply to, so nothing of theirs was missed. */
	fullPacks: Set<string>;
}

/** A scope in which every named pack read everything it applies to. */
export function fullScope(packs: Iterable<string>): ScanScope {
	return {scannedByPack: new Map(), fullPacks: new Set(packs)};
}

/**
 * True when no pack ran with a reduced file set, so this run is equivalent to
 * the pre-incremental behaviour and nothing can be held.
 */
export function isCompleteScope(scope: ScanScope): boolean {
	return scope.scannedByPack.size === 0;
}

/**
 * Whether an open issue's subject was actually read this run, and therefore
 * whether its absence from the findings is evidence that it is gone.
 *
 * `pack` and `path` come from the issue's own markers, so both are `null` for
 * issues filed before those markers existed.
 *
 * The unmarked case is decided in the safe direction: on a complete run it is
 * "scanned", which is exactly today's behaviour and keeps existing installs
 * byte-identical; on a partial run it is "held", because an issue we cannot
 * attribute to a file is an issue we cannot prove we looked at. Holding is
 * recoverable — the issue simply stays open — whereas closing is not.
 *
 * In practice unmarked issues do not survive to see a partial run: the cache
 * that enables partial runs cannot exist on the first run, so that run is
 * complete, and every issue whose finding still recurs is touched and has its
 * markers backfilled before any file is ever skipped.
 */
export function issueWasScanned(
	scope: ScanScope | undefined,
	pack: string | null,
	path: string | null,
): boolean {
	// No scope means the caller is not tracking one: every file was read.
	if (!scope || isCompleteScope(scope)) {
		return true;
	}
	if (pack === null || path === null) {
		return false;
	}
	if (scope.fullPacks.has(pack)) {
		return true;
	}
	const scanned = scope.scannedByPack.get(pack);
	// A pack absent from the scope did not run at all this time — the target no
	// longer names it, or it failed to resolve. That is not an incremental skip,
	// and its issues should age out as they always have.
	if (!scanned) {
		return true;
	}
	return scanned.has(path);
}
