/**
 * Clone target repositories into the run workspace. The audited repos are named
 * in sentinel.yaml, not known to the workflow statically, so `sentinel run`
 * clones any that are not already present.
 *
 * The decision — clone, skip, or refuse — is pure and tested behind an injected
 * probe. Only the `gh` spawn and the real filesystem reads are ignored for
 * coverage, because "is this directory a usable checkout of the right repo?" is
 * exactly the logic that must not go unexercised: getting it wrong produces
 * findings against stale source, presented as current.
 */

import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

/** Build the `gh repo clone` argv for a shallow single-branch clone. */
export function buildCloneArgs(repo: string, dir: string): string[] {
	return ['repo', 'clone', repo, dir, '--', '--depth', '1', '--single-branch'];
}

/** The outcome of ensuring one repo is present in the workspace. */
export interface PrepareResult {
	ok: boolean;
	/** True if the repo was already present and no clone was attempted. */
	skipped: boolean;
	error?: string;
}

/**
 * Reduce `owner/repo`, an https URL or an scp-style SSH remote to `owner/repo`
 * in lower case. Returns null if the input carries no such pair.
 *
 * Deliberately lenient about the things that do not change identity — scheme,
 * host, credentials, a `.git` suffix, a trailing slash, case — and strict about
 * the pair itself. A remote comparison that is too strict is worse than none:
 * it refuses to audit a correctly checked-out repository.
 */
export function normaliseRepoRef(ref: string): string | null {
	let text = ref.trim();
	if (text.length === 0) {
		return null;
	}

	// Deliberately parsed with string operations rather than regular
	// expressions. The input is a git remote URL read off disk, so it is not
	// under our control, and the obvious patterns for this shape
	// (`^[^/]+@[^/:]+:(.+)$` and friends) backtrack polynomially — CodeQL flags
	// them as ReDoS, correctly. Everything below is a single linear scan.
	const scheme = text.indexOf('://');
	if (scheme !== -1) {
		// scheme://[credentials@]host/owner/repo — drop through the first slash
		// after the host, whatever the authority contains.
		const afterScheme = text.slice(scheme + 3);
		const slash = afterScheme.indexOf('/');
		text = slash === -1 ? '' : afterScheme.slice(slash + 1);
	} else {
		// scp-style SSH: user@host:owner/repo. Only when the authority really
		// does precede the colon, so a bare `owner/repo` is left alone.
		const colon = text.indexOf(':');
		if (colon !== -1 && text.lastIndexOf('@', colon) !== -1) {
			text = text.slice(colon + 1);
		}
	}

	// Splitting before stripping `.git` means a trailing slash is handled by the
	// same pass, in either order (`owner/repo.git/` as well as `owner/repo/`).
	const segments = text.split('/').filter(segment => segment.length > 0);
	if (segments.length < 2) {
		return null;
	}
	// The last two segments are owner/repo; anything before is host or path.
	const owner = segments[segments.length - 2] as string;
	let repo = segments[segments.length - 1] as string;
	if (repo.endsWith('.git')) {
		repo = repo.slice(0, -4);
	}
	if (repo.length === 0) {
		return null;
	}
	return `${owner}/${repo}`.toLowerCase();
}

/** True if a git remote URL points at the given `owner/repo`. */
export function remoteMatchesRepo(remoteUrl: string, repo: string): boolean {
	const remote = normaliseRepoRef(remoteUrl);
	const wanted = normaliseRepoRef(repo);
	return remote !== null && wanted !== null && remote === wanted;
}

/** What the workspace directory for one repo currently is. */
export type CheckoutState =
	| {kind: 'absent'}
	| {kind: 'usable'}
	| {kind: 'unusable'; reason: string};

/** Filesystem and git probes, injected so the decision logic is testable. */
export interface CheckoutProbe {
	/** True if the path exists and is a directory. */
	isDirectory(path: string): boolean;
	/** True if the path exists at all (file or directory). */
	exists(path: string): boolean;
	/** Entry names directly under the directory. */
	entries(path: string): string[];
	/** The checkout's `origin` remote URL, or null if it has none. */
	originUrl(path: string): string | null;
}

/**
 * Decide what to do with the workspace directory for `repo`.
 *
 * Previously any existing directory counted as a valid checkout, so an empty
 * directory, a half-finished clone from an interrupted run, or a checkout of a
 * different repository entirely all reported success and were then audited as
 * if current.
 *
 * `unusable` never means "delete it". The workspace can be somebody's own
 * checkouts, and silently removing a directory to fix an audit is a far worse
 * failure than declining to audit it.
 */
export function inspectCheckout(
	repo: string,
	dir: string,
	probe: CheckoutProbe,
): CheckoutState {
	if (!probe.exists(dir)) {
		return {kind: 'absent'};
	}
	if (!probe.isDirectory(dir)) {
		return {
			kind: 'unusable',
			reason: `${dir} exists but is not a directory`,
		};
	}
	if (probe.entries(dir).length === 0) {
		// An empty directory is almost always our own interrupted clone, and git
		// clones happily into one. Treat it as absent rather than as a checkout.
		return {kind: 'absent'};
	}
	// `.git` is a directory in a normal clone and a file in a worktree or
	// submodule, so presence is the right test rather than directory-ness.
	if (!probe.exists(join(dir, '.git'))) {
		return {
			kind: 'unusable',
			reason: `${dir} is not empty but has no .git — a partial clone or an unrelated directory. Remove it, or point --workspace elsewhere`,
		};
	}

	const origin = probe.originUrl(dir);
	if (origin === null) {
		// A checkout with no origin cannot be proven to be the right repository.
		// Auditing it anyway is what the bug did.
		return {
			kind: 'unusable',
			reason: `${dir} is a git checkout with no origin remote, so it cannot be confirmed as ${repo}`,
		};
	}
	if (!remoteMatchesRepo(origin, repo)) {
		return {
			kind: 'unusable',
			reason: `${dir} is a checkout of ${origin}, not ${repo} — auditing it would report findings against the wrong repository`,
		};
	}
	return {kind: 'usable'};
}

/* c8 ignore start -- spawns gh and touches the filesystem. */
/** The real probe: node's fs plus `git remote` for the origin URL. */
const fsCheckoutProbe: CheckoutProbe = {
	isDirectory(path: string): boolean {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
	exists(path: string): boolean {
		return existsSync(path);
	},
	entries(path: string): string[] {
		try {
			return readdirSync(path);
		} catch {
			return [];
		}
	},
	originUrl(path: string): string | null {
		const run = spawnSync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		});
		if (run.error || run.status !== 0) {
			return null;
		}
		const url = (run.stdout ?? '').trim();
		return url.length > 0 ? url : null;
	},
};

/**
 * Ensure a single repo is checked out at `dir`, cloning it if missing. Returns
 * a result rather than throwing so one failure does not abort a run.
 */
export async function prepareRepo(
	repo: string,
	dir: string,
	probe: CheckoutProbe = fsCheckoutProbe,
): Promise<PrepareResult> {
	const state = inspectCheckout(repo, dir, probe);
	if (state.kind === 'usable') {
		return {ok: true, skipped: true};
	}
	if (state.kind === 'unusable') {
		return {ok: false, skipped: false, error: state.reason};
	}

	const run = spawnSync('gh', buildCloneArgs(repo, dir), {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
	if (run.error) {
		const code = (run.error as NodeJS.ErrnoException).code;
		return {
			ok: false,
			skipped: false,
			error:
				code === 'ENOENT'
					? '`gh` is not on PATH. Install the GitHub CLI.'
					: String(run.error),
		};
	}
	if (run.status !== 0) {
		return {ok: false, skipped: false, error: (run.stderr ?? '').trim()};
	}
	return {ok: true, skipped: false};
}
/* c8 ignore stop */
