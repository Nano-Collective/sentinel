/**
 * The durable per-run record and the shapes the dashboard renders from. One
 * record is committed to the config repo per run (the durable store); the
 * dashboard is the read-side surface generated from the records
 * (see docs/workflow/index.md#observability-and-run-history).
 */

import type {Severity} from '../findings/types.js';

/** Finding counts broken down by severity. */
export type SeverityCounts = Record<Severity, number>;

/** One pack's contribution within a repo, for the record. */
export interface PackRunRecord {
	pack: string;
	version: string;
	findings: number;
	ok: boolean;
}

/** One repository's result within a run. */
export interface RepoRunRecord {
	repo: string;
	findings: number;
	bySeverity: SeverityCounts;
	packs: PackRunRecord[];
	/**
	 * Packs that re-read every file on a target that asked for incremental
	 * scanning, as `pack — reason` lines.
	 *
	 * In the durable record and not only the run report, because the report is
	 * an Actions step summary that expires. An operator who enabled incremental
	 * scanning, opened the dashboard a week later and asked why a run did a full
	 * read would otherwise have nowhere to look — and this is their only signal
	 * that the setting they turned on is not doing anything. Same reason
	 * `packLoadErrors` is on the record rather than only in the console.
	 */
	fullPasses?: string[];
}

/** The mode a run executed in. */
export type RunMode = 'live' | 'dry-run' | 'audit-only';

/**
 * What a run cost the model, aggregated across every pack pass. `sentinel
 * estimate` reads these back to calibrate its figures.
 */
export interface RunUsage {
	/** Model invocations, auto-fix retries included. */
	requests: number;
	/** Wall-clock milliseconds spent in the model. */
	durationMs: number;
	/** Estimated prompt tokens sent. */
	promptTokens: number;
	/** Estimated tokens returned. */
	outputTokens: number;
}

/** Issue-filing totals for a live run. */
export interface FilingSummary {
	filed: number;
	touched: number;
	incremented: number;
	suppressed: number;
	suppressedByOverride: number;
	resolved: number;
	/**
	 * Open issues left untouched because the run did not read their file.
	 *
	 * Optional because records written before incremental scanning existed have
	 * no such field, and absent is not the same as zero: a record without it
	 * cannot tell you whether the run held nothing or was simply too old to know.
	 * The record is the durable artifact, so that distinction has to survive in
	 * it — the same reason `packLoadErrors` is optional rather than defaulted.
	 */
	held?: number;
}

/** A committed record of one Sentinel run. */
export interface RunRecord {
	/** ISO timestamp of the run. */
	timestamp: string;
	mode: RunMode;
	repos: RepoRunRecord[];
	totals: {
		repos: number;
		findings: number;
		bySeverity: SeverityCounts;
		/** Absent on records written before runs were instrumented. */
		usage?: RunUsage;
	};
	/** Present on a live run. */
	filing?: FilingSummary;
	/** Target-expansion / clone failures, carried for visibility. */
	targetErrors: string[];
	/**
	 * Rule packs that failed to parse and therefore ran against nothing, as
	 * `file — detail` lines. Optional: records written before runs carried this
	 * have no such field, and an absent field is not the same as an empty one.
	 *
	 * A record that omits this cannot be told apart from a clean run, which is
	 * the whole failure this release is about — the record is the durable
	 * artifact, so a finding count of zero has to be readable as "nothing found"
	 * or "nothing ran" from the record alone.
	 */
	packLoadErrors?: string[];
}
