/**
 * Pure helpers for selecting pack files and the file patterns to gather. A pack
 * file is an enabled `.md` whose path contains no underscore-prefixed segment —
 * the `_starter/` convention that keeps template packs from loading.
 */

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
