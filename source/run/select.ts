/**
 * Pure helpers for selecting the packs a run executes: which files in the
 * rule-packs directory are packs at all, which packs a target resolves to, and
 * which repository files they need gathered. A pack file is an enabled `.md`
 * whose path contains no underscore-prefixed segment — the `_starter/`
 * convention that keeps template packs from loading.
 */

import {resolveDependencies} from '../rule-packs/dependencies.js';
import type {RulePack} from '../rule-packs/types.js';

/** True if a rule-packs-relative path is an enabled pack file. */
export function isEnabledPackPath(relativePath: string): boolean {
	if (!relativePath.endsWith('.md')) {
		return false;
	}
	return relativePath
		.split('/')
		.every(segment => segment.length > 0 && !segment.startsWith('_'));
}

/**
 * The union of applies_to path globs across packs. Returns an empty list if any
 * pack applies to the whole repository (empty paths), meaning "gather all".
 */
export function unionPatterns(packs: RulePack[]): string[] {
	const patterns = new Set<string>();
	for (const pack of packs) {
		if (pack.manifest.appliesTo.paths.length === 0) {
			return [];
		}
		for (const pattern of pack.manifest.appliesTo.paths) {
			patterns.add(pattern);
		}
	}
	return [...patterns];
}

/** The packs one target actually runs, and the names that did not resolve. */
export interface SelectedPacks {
	packs: RulePack[];
	/** Named packs missing from the directory or with an unresolvable chain. */
	missing: string[];
}

/**
 * Resolve a target's rule pack names into the packs to run, pulling in each
 * pack's `depends_on` chain and de-duplicating across names.
 */
export function selectPacks(
	available: RulePack[],
	names: string[],
): SelectedPacks {
	const byName = new Map(available.map(pack => [pack.manifest.name, pack]));
	const resolved = new Set<string>();
	const missing: string[] = [];

	for (const name of names) {
		if (!byName.has(name)) {
			missing.push(name);
			continue;
		}
		const chain = resolveDependencies(available, name);
		if (chain.errors.length > 0) {
			missing.push(name);
			continue;
		}
		for (const resolvedName of chain.order) {
			resolved.add(resolvedName);
		}
	}

	const packs: RulePack[] = [];
	for (const name of resolved) {
		const pack = byName.get(name);
		if (pack) {
			packs.push(pack);
		}
	}
	return {packs, missing};
}
