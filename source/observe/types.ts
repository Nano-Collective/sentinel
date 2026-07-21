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
}

/** The mode a run executed in. */
export type RunMode = 'live' | 'dry-run' | 'audit-only';

/** Issue-filing totals for a live run. */
export interface FilingSummary {
	filed: number;
	touched: number;
	resolved: number;
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
	};
	/** Present on a live run. */
	filing?: FilingSummary;
	/** Target-expansion / clone failures, carried for visibility. */
	targetErrors: string[];
}
