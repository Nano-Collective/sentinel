/**
 * A small glob matcher for `applies_to.paths`. Supports the subset of glob
 * syntax rule packs actually use:
 *
 *   **  matches any number of path segments, including none
 *   *   matches any run of characters within a single segment (not `/`)
 *   ?   matches a single character within a segment (not `/`)
 *
 * Anything else is treated literally. This is deliberately not a full glob
 * implementation; the orchestrator can reach for a heavier library if a pack
 * ever needs brace expansion or character classes.
 */

import type {RulePackManifest} from './types.js';

function escapeRegExp(literal: string): string {
	return literal.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Compile a single glob pattern to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
	let out = '';
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === '*') {
			if (pattern[i + 1] === '*') {
				// `**` — cross segment boundaries. Consume a trailing slash so that
				// `a/**/b` still matches `a/b` with no intervening segment.
				i++;
				if (pattern[i + 1] === '/') {
					i++;
					out += '(?:.*/)?';
				} else {
					out += '.*';
				}
			} else {
				out += '[^/]*';
			}
		} else if (char === '?') {
			out += '[^/]';
		} else {
			out += escapeRegExp(char as string);
		}
	}
	// The pattern is built from a rule pack's applies_to globs (the installing
	// org's own files), with all regex specials escaped and only bounded `*`,
	// `**`, and `?` expansions — no attacker-controlled quantifiers.
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
	return new RegExp(`^${out}$`);
}

/** Returns true if a POSIX-style path matches the glob pattern. */
export function matchesGlob(pattern: string, path: string): boolean {
	return globToRegExp(pattern).test(path);
}

/**
 * Returns true if a file should be read under a pack's `applies_to.paths`. An
 * empty path list means the pack applies to the whole repository.
 */
export function matchesAppliesTo(
	manifest: RulePackManifest,
	path: string,
): boolean {
	const {paths} = manifest.appliesTo;
	if (paths.length === 0) {
		return true;
	}
	return paths.some(pattern => matchesGlob(pattern, path));
}
