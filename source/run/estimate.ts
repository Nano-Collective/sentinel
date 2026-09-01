/**
 * Pre-flight estimation for `sentinel estimate`. Answers the questions an
 * operator asks before pointing Sentinel at an organisation — how many model
 * requests and tokens will this cost, and how long will it take — without
 * invoking a model (see docs/cli/index.md#estimate).
 *
 * The prompts are assembled exactly as an audit assembles them, so the token
 * figure is measured rather than guessed. The per-request figures come from the
 * committed run records when any exist, so an install's estimates sharpen
 * against its own hardware and model instead of a built-in constant.
 */

import {join} from 'node:path';
import type {SentinelConfig} from '../config/types.js';
import type {RunRecord, RunUsage} from '../observe/types.js';
import {buildAuditPrompt} from '../prompt/build.js';
import type {PrepareResult} from './clone.js';
import {expandTargets} from './expand.js';
import type {RepoLister} from './repo-lister.js';
import {selectPacks, unionPatterns} from './select.js';
import type {PackLoadError, PackLoader, RepoFiles} from './types.js';

/** Characters per token — a coarse average across code and English prose. */
const CHARS_PER_TOKEN = 4;

/** How many recent records to calibrate from; enough to smooth a slow run. */
const CALIBRATION_WINDOW = 10;

/** The per-request figures an estimate is built from. */
export interface Calibration {
	/**
	 * Fixed wall-clock milliseconds a request costs regardless of size — process
	 * start, model load, the round trip.
	 */
	msPerRequest: number;
	/**
	 * Marginal milliseconds per prompt token. Runtime is dominated by prompt size
	 * on a local model, so an estimate for a config far larger than the recorded
	 * ones would be wrong by roughly that ratio without this term.
	 */
	msPerPromptToken: number;
	/** Requests per pack pass — above 1 when auto-fix retries are common. */
	requestsPerPass: number;
	/** Tokens the model returns per request. */
	outputTokensPerRequest: number;
	/** Run records the figures came from; 0 means the built-in defaults. */
	samples: number;
}

/**
 * Used until a run has been recorded: a minute-ish per request on a local
 * model, and roughly one pass in ten needing the auto-fix retry. The two
 * duration terms sum to that 45s at a 2,500-token prompt — a typical single
 * pack pass — and diverge from it as prompts get larger or smaller.
 */
const DEFAULT_CALIBRATION: Calibration = {
	msPerRequest: 20_000,
	msPerPromptToken: 10,
	requestsPerPass: 1.1,
	outputTokensPerRequest: 700,
	samples: 0,
};

/** One repository's share of an estimate. */
export interface RepoEstimate {
	repo: string;
	/** The packs that will run, `depends_on` chains included. */
	packs: string[];
	/** Distinct files at least one pack will send to the model. */
	files: number;
	/**
	 * Whether the repository is present under the workspace at all. Separate
	 * from `files`, which is a count after `applies_to` scoping: a checked-out
	 * repo that no pack matches also has zero files, and cloning will not fix
	 * it, so the two need different advice.
	 */
	checkedOut: boolean;
	/** Model requests, retries included. */
	requests: number;
	tokens: number;
	durationMs: number;
	/** Packs the target names that the rule-packs directory does not have. */
	missingPacks: string[];
}

/** Everything `sentinel estimate` computed. */
export interface AuditEstimate {
	repos: RepoEstimate[];
	totals: {
		repos: number;
		/** Distinct packs across every repository. */
		rulePacks: number;
		files: number;
		requests: number;
		tokens: number;
		durationMs: number;
	};
	calibration: Calibration;
	packLoadErrors: PackLoadError[];
	/** Target-expansion and clone failures. */
	targetErrors: string[];
}

/** Injected dependencies for an estimate. All reads, no model, no mutation. */
export interface EstimateDeps {
	files: RepoFiles;
	packs: PackLoader;
	/** Lists an owner's repos to expand pattern targets. */
	repoLister?: RepoLister;
	/** Checks out missing target repos; omit to estimate from what is present. */
	cloneRepo?: (repo: string, dir: string) => Promise<PrepareResult>;
	/** Prior run records, for calibration. */
	records?: RunRecord[];
}

/** Options for an estimate. Mirrors the run options it predicts. */
export interface EstimateOptions {
	/** Directory the target repos are checked out under. */
	workspaceDir: string;
	/** The config repo's rule-packs directory. */
	packsDir: string;
}

/** Approximate the token count of a piece of prompt or completion text. */
export function estimateTokens(text: string): number {
	return tokensFromChars(text.length);
}

/**
 * The same approximation for a character count already accumulated — the audit
 * loop totals characters across retries rather than holding every prompt.
 */
export function tokensFromChars(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** One record reduced to per-request cost against per-request prompt size. */
interface DurationPoint {
	tokens: number;
	ms: number;
}

/**
 * Least-squares fit of ms = msPerRequest + msPerPromptToken * tokens.
 *
 * Returns null when the records cannot separate the two terms — fewer than two
 * of them, or every run the same prompt size — and when the fit comes back
 * nonsensical (a negative term, which noise across few samples can produce).
 * The caller falls back to splitting the observed average instead.
 */
function fitDurationTerms(
	points: DurationPoint[],
): Pick<Calibration, 'msPerRequest' | 'msPerPromptToken'> | null {
	if (points.length < 2) {
		return null;
	}

	const meanTokens =
		points.reduce((total, point) => total + point.tokens, 0) / points.length;
	const meanMs =
		points.reduce((total, point) => total + point.ms, 0) / points.length;

	let variance = 0;
	let covariance = 0;
	for (const point of points) {
		const spread = point.tokens - meanTokens;
		variance += spread * spread;
		covariance += spread * (point.ms - meanMs);
	}
	if (variance === 0) {
		return null;
	}

	const msPerPromptToken = covariance / variance;
	const msPerRequest = meanMs - msPerPromptToken * meanTokens;
	if (msPerPromptToken < 0 || msPerRequest < 0) {
		return null;
	}
	return {msPerRequest, msPerPromptToken};
}

/**
 * Split one averaged observation across the two duration terms, keeping the
 * proportion the built-in defaults imply at that prompt size. Used when the
 * records cannot support a fit: the magnitude is measured even though the
 * shape is assumed, which beats attributing all of it to either term.
 */
function splitDurationTerms(
	msPerRequest: number,
	tokensPerRequest: number,
): Pick<Calibration, 'msPerRequest' | 'msPerPromptToken'> {
	if (tokensPerRequest <= 0) {
		return {msPerRequest, msPerPromptToken: 0};
	}
	const shape =
		DEFAULT_CALIBRATION.msPerRequest +
		DEFAULT_CALIBRATION.msPerPromptToken * tokensPerRequest;
	const fixedShare = DEFAULT_CALIBRATION.msPerRequest / shape;
	return {
		msPerRequest: msPerRequest * fixedShare,
		msPerPromptToken: (msPerRequest * (1 - fixedShare)) / tokensPerRequest,
	};
}

/**
 * Derive per-request figures from the most recent run records that carry usage.
 * Records written before instrumentation, and runs that made no request, are
 * skipped; with nothing usable left the built-in defaults stand.
 */
export function calibrate(records: RunRecord[]): Calibration {
	const sorted = [...records].sort((a, b) =>
		b.timestamp.localeCompare(a.timestamp),
	);

	const usable: {usage: RunUsage; passes: number}[] = [];
	for (const record of sorted) {
		const usage = record.totals.usage;
		if (!usage || usage.requests <= 0) {
			continue;
		}
		usable.push({
			usage,
			passes: record.repos.reduce(
				(total, repo) => total + repo.packs.length,
				0,
			),
		});
		if (usable.length === CALIBRATION_WINDOW) {
			break;
		}
	}

	if (usable.length === 0) {
		return {...DEFAULT_CALIBRATION};
	}

	let requests = 0;
	let passes = 0;
	let durationMs = 0;
	let outputTokens = 0;
	let promptTokens = 0;
	const points: DurationPoint[] = [];
	for (const sample of usable) {
		requests += sample.usage.requests;
		durationMs += sample.usage.durationMs;
		outputTokens += sample.usage.outputTokens;
		promptTokens += sample.usage.promptTokens;
		passes += sample.passes;
		points.push({
			tokens: sample.usage.promptTokens / sample.usage.requests,
			ms: sample.usage.durationMs / sample.usage.requests,
		});
	}

	// Prefer separating the fixed and per-token terms from the spread across
	// records; fall back to splitting the pooled average when they cannot.
	const duration =
		fitDurationTerms(points) ??
		splitDurationTerms(durationMs / requests, promptTokens / requests);

	return {
		...duration,
		requestsPerPass:
			passes > 0
				? Math.max(1, requests / passes)
				: DEFAULT_CALIBRATION.requestsPerPass,
		outputTokensPerRequest: outputTokens / requests,
		samples: usable.length,
	};
}

/** Estimate what a config-driven run would cost, without running it. */
export async function estimateRun(
	config: SentinelConfig,
	deps: EstimateDeps,
	options: EstimateOptions,
): Promise<AuditEstimate> {
	const loaded = await deps.packs.load(options.packsDir);
	const calibration = calibrate(deps.records ?? []);

	const expanded = await expandTargets(config.targets, deps.repoLister);
	const targetErrors = [...expanded.errors];
	const repos: RepoEstimate[] = [];

	for (const target of expanded.targets) {
		const repoDir = join(options.workspaceDir, target.repo);

		if (deps.cloneRepo) {
			const prepared = await deps.cloneRepo(target.repo, repoDir);
			if (!prepared.ok) {
				targetErrors.push(
					`could not check out ${target.repo}: ${prepared.error ?? 'clone failed'}`,
				);
				continue;
			}
		}

		const {packs, missing} = selectPacks(loaded.packs, target.rulePacks);
		const files = await deps.files.read(repoDir, unionPatterns(packs));

		// `read` applies the patterns it is given, so this count alone cannot tell
		// an absent checkout from a present one that nothing matched. Only when it
		// comes back empty is an unscoped read worth its cost, and only then can
		// it change which warning the operator gets.
		const checkedOut =
			files.length > 0 || (await deps.files.read(repoDir, [])).length > 0;

		// Build the real prompts: what the model is sent is what we count.
		const audited = new Set<string>();
		let promptTokens = 0;
		for (const pack of packs) {
			const built = buildAuditPrompt({pack, files, repoName: target.repo});
			promptTokens += estimateTokens(built.prompt);
			for (const path of built.includedFiles) {
				audited.add(path);
			}
		}

		const requests = Math.round(packs.length * calibration.requestsPerPass);
		// A retry resends the prompt, so both sides scale with requests.
		const promptTokensSent = Math.round(
			promptTokens * calibration.requestsPerPass,
		);
		repos.push({
			repo: target.repo,
			packs: packs.map(pack => pack.manifest.name),
			files: audited.size,
			checkedOut,
			requests,
			tokens:
				promptTokensSent +
				Math.round(requests * calibration.outputTokensPerRequest),
			// Fixed per-request cost plus the part that tracks prompt size, so a
			// config far larger than the recorded runs is not priced as if it were
			// the same size.
			durationMs: Math.round(
				requests * calibration.msPerRequest +
					promptTokensSent * calibration.msPerPromptToken,
			),
			missingPacks: missing,
		});
	}

	const sum = (pick: (repo: RepoEstimate) => number): number =>
		repos.reduce((total, repo) => total + pick(repo), 0);

	return {
		repos,
		totals: {
			repos: repos.length,
			rulePacks: new Set(repos.flatMap(repo => repo.packs)).size,
			files: sum(repo => repo.files),
			requests: sum(repo => repo.requests),
			tokens: sum(repo => repo.tokens),
			durationMs: sum(repo => repo.durationMs),
		},
		calibration,
		packLoadErrors: loaded.errors,
		targetErrors,
	};
}

function formatInt(value: number): string {
	return Math.round(value).toLocaleString('en-US');
}

/** Compact token counts: 812, 41.2K, 3.8M. */
function formatTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}K`;
	}
	return String(Math.round(value));
}

/** Wall-clock, rounded to the unit an operator actually schedules in. */
function formatDuration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	// Hand over at a minute, not 90s: rounding the minutes figure from 90s
	// upward would otherwise make "1 minute(s)" unreachable.
	if (seconds < 60) {
		return `${seconds} second(s)`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 90) {
		return `${minutes} minute(s)`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} hour(s)` : `${hours} hour(s) ${rest} minute(s)`;
}

function repoRow(repo: RepoEstimate): string {
	return `| \`${repo.repo}\` | ${repo.packs.length} | ${formatInt(repo.files)} | ~${formatInt(repo.requests)} | ~${formatTokens(repo.tokens)} | ~${formatDuration(repo.durationMs)} |`;
}

/** Notes that keep an understated estimate from reading as the whole picture. */
function caveats(estimate: AuditEstimate): string[] {
	const notes: string[] = [];

	const absent = estimate.repos.filter(repo => !repo.checkedOut);
	if (absent.length > 0) {
		notes.push(
			`> ⚠️ ${absent.length} repo(s) are not checked out, so their cost is understated — check them out under the workspace, or pass --clone: ${absent.map(repo => repo.repo).join(', ')}`,
		);
	}

	// Present but scoped away: nothing to clone, and a pack is pointed at a repo
	// it cannot see — the more useful of the two warnings.
	const unmatched = estimate.repos.filter(
		repo => repo.checkedOut && repo.files === 0,
	);
	if (unmatched.length > 0) {
		notes.push(
			`> ⚠️ ${unmatched.length} repo(s) are checked out but no file matched their packs' applies_to, so they will audit nothing: ${unmatched.map(repo => repo.repo).join(', ')}`,
		);
	}
	for (const repo of estimate.repos) {
		if (repo.missingPacks.length > 0) {
			notes.push(
				`> ⚠️ ${repo.repo}: rule pack(s) not in rule-packs/ — ${repo.missingPacks.join(', ')}`,
			);
		}
	}
	for (const error of estimate.packLoadErrors) {
		notes.push(
			`> ⚠️ rule pack \`${error.file}\` failed to parse and will not run`,
		);
	}
	for (const error of estimate.targetErrors) {
		notes.push(`> ⚠️ ${error}`);
	}
	return notes;
}

/** Render an estimate as Markdown, for stdout or `--output`. */
export function renderEstimate(estimate: AuditEstimate): string {
	const {totals, calibration} = estimate;

	const parts = [
		'# Sentinel audit estimate',
		[
			`- **Repositories:** ${formatInt(totals.repos)}`,
			`- **Rule packs:** ${formatInt(totals.rulePacks)}`,
			`- **Files:** ${formatInt(totals.files)}`,
			`- **Estimated AI requests:** ~${formatInt(totals.requests)}`,
			`- **Estimated tokens:** ~${formatTokens(totals.tokens)}`,
			`- **Estimated runtime:** ~${formatDuration(totals.durationMs)}`,
		].join('\n'),
		calibration.samples > 0
			? `Calibrated from the last ${calibration.samples} run record(s).`
			: 'No run records yet — these use built-in defaults and sharpen once runs are recorded.',
	];

	if (estimate.repos.length === 0) {
		parts.push('No repositories resolved from the config.');
	} else {
		parts.push(
			[
				'## Per repository',
				'',
				'| Repository | Packs | Files | Requests | Tokens | Runtime |',
				'| --- | --- | --- | --- | --- | --- |',
				...estimate.repos.map(repoRow),
			].join('\n'),
		);
	}

	const notes = caveats(estimate);
	if (notes.length > 0) {
		parts.push(notes.join('\n'));
	}

	return parts.join('\n\n');
}
