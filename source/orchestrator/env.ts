/**
 * The environment handed to the model subprocess.
 *
 * Sentinel runs the model against a repository it does not control, in
 * Nanocoder's auto-approve mode, with the audited repo's own files pasted
 * verbatim into the prompt. The process running that spawn holds a GitHub token
 * the docs tell operators to provision org-wide with `repo` and `issues` scope,
 * so the audit can file issues on repositories other than the config repo.
 *
 * Nanocoder never needs that token: it reads code and returns a findings array,
 * and the token is consumed afterwards by a separate spawn in
 * `issues/gh-client.ts`. So the child gets an allowlist rather than a copy of
 * the parent environment — and an allowlist rather than a list of names to
 * strip, because the next credential a runner invents is one nobody has thought
 * to add to a denylist.
 *
 * What the child legitimately needs is the operator's model credential, whose
 * variable name only they know. They have already told us: `agents.config.json`
 * references it as a `${PLACEHOLDER}`, so the allowlist is derived from their
 * own configuration rather than guessed.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Variables any child process needs in order to run at all — locate binaries,
 * find a home and a temp directory, resolve a locale, reach the network through
 * a proxy. Matched case-insensitively: Windows environment lookups are, and
 * `Path` and `PATH` must not resolve differently here than they do there.
 */
const ESSENTIAL_ENV = [
	// POSIX process basics.
	'PATH',
	'HOME',
	'SHELL',
	'USER',
	'LOGNAME',
	'PWD',
	'TMPDIR',
	'TMP',
	'TEMP',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TZ',
	// Terminal and CI shape. Nanocoder picks its plain runtime off these.
	'TERM',
	'COLORTERM',
	'NO_COLOR',
	'FORCE_COLOR',
	'CI',
	// Node's own runtime knobs, including custom CA bundles.
	'NODE_OPTIONS',
	'NODE_EXTRA_CA_CERTS',
	'NODE_PATH',
	// Networking through a corporate proxy.
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'ALL_PROXY',
	'NO_PROXY',
	// Where Nanocoder looks for its own state when not pointed elsewhere.
	'XDG_CONFIG_HOME',
	'XDG_DATA_HOME',
	'XDG_CACHE_HOME',
	'XDG_STATE_HOME',
	// Windows equivalents of the above.
	'SYSTEMROOT',
	'SYSTEMDRIVE',
	'WINDIR',
	'COMSPEC',
	'PATHEXT',
	'APPDATA',
	'LOCALAPPDATA',
	'PROGRAMDATA',
	'PROGRAMFILES',
	'PROGRAMFILES(X86)',
	'USERPROFILE',
	'USERNAME',
	'HOMEDRIVE',
	'HOMEPATH',
	'NUMBER_OF_PROCESSORS',
	'PROCESSOR_ARCHITECTURE',
	'OS',
];

/**
 * An operator-controlled escape hatch, read from the parent environment. The
 * derivation below sees `${PLACEHOLDER}` references in `agents.config.json`; a
 * provider that reads its key straight from the environment leaves no such
 * trace, and this is how that operator says so rather than being stuck.
 */
const PASSTHROUGH_VAR = 'SENTINEL_PASSTHROUGH_ENV';

/** `${NAME}` as Nanocoder's config substitution writes it. */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Every `${NAME}` referenced in an `agents.config.json` document. These are the
 * variables the operator's provider wiring actually depends on — API keys,
 * endpoints, organisation ids — named by the operator, not guessed by us.
 */
export function placeholderNames(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (name !== undefined) {
			names.add(name);
		}
	}
	return [...names];
}

/**
 * The placeholder names in the config directory's `agents.config.json`. A
 * missing or unreadable file means no derived names: the essentials still get
 * through, and a model that cannot authenticate fails loudly on its own rather
 * than being papered over by handing the child everything.
 */
export function modelEnvNames(configDir: string | undefined): string[] {
	if (configDir === undefined) {
		return [];
	}
	try {
		return placeholderNames(
			readFileSync(join(configDir, 'agents.config.json'), 'utf8'), // nosemgrep
		);
	} catch {
		return [];
	}
}

/** The names listed in SENTINEL_PASSTHROUGH_ENV, comma-separated. */
export function passthroughNames(base: NodeJS.ProcessEnv): string[] {
	return (base[PASSTHROUGH_VAR] ?? '')
		.split(',')
		.map(name => name.trim())
		.filter(name => name.length > 0);
}

/**
 * Build the child environment: the essentials, plus the named variables, plus
 * nothing else. Pure — the caller decides which names are allowed.
 */
export function scopeEnv(
	base: NodeJS.ProcessEnv,
	allowNames: string[],
): NodeJS.ProcessEnv {
	const allowed = new Set(
		[...ESSENTIAL_ENV, ...allowNames].map(name => name.toUpperCase()),
	);
	const scoped: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(base)) {
		if (value !== undefined && allowed.has(name.toUpperCase())) {
			scoped[name] = value;
		}
	}
	return scoped;
}
