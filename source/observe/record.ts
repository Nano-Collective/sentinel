/**
 * Build a durable {@link RunRecord} from a run's {@link RunReport}. Pure — the
 * CLI stamps the timestamp and mode and writes the JSON.
 */

import {SEVERITIES, type Severity} from '../findings/types.js';
import type {RunReport} from '../run/run.js';
import type {RepoOutcome} from '../run/types.js';
import type {
	FilingSummary,
	RepoRunRecord,
	RunMode,
	RunRecord,
	SeverityCounts,
} from './types.js';

function emptyCounts(): SeverityCounts {
	return {low: 0, medium: 0, high: 0, critical: 0};
}

function addCounts(into: SeverityCounts, from: SeverityCounts): void {
	for (const severity of SEVERITIES) {
		into[severity] += from[severity];
	}
}

function repoRecord(outcome: RepoOutcome): RepoRunRecord {
	const bySeverity = emptyCounts();
	let findings = 0;
	const packs = outcome.packs.map(pack => {
		for (const finding of pack.findings) {
			bySeverity[finding.severity as Severity] += 1;
		}
		findings += pack.findings.length;
		return {
			pack: pack.pack,
			version: pack.version,
			findings: pack.findings.length,
			ok: pack.ok,
		};
	});
	return {repo: outcome.repo, findings, bySeverity, packs};
}

/** Build a run record from a report, a timestamp, and the run mode. */
export function buildRunRecord(
	report: RunReport,
	timestamp: string,
	mode: RunMode,
): RunRecord {
	const repos = report.outcome.repos.map(repoRecord);

	const totalsBySeverity = emptyCounts();
	let totalFindings = 0;
	for (const repo of repos) {
		addCounts(totalsBySeverity, repo.bySeverity);
		totalFindings += repo.findings;
	}

	const record: RunRecord = {
		timestamp,
		mode,
		repos,
		totals: {
			repos: repos.length,
			findings: totalFindings,
			bySeverity: totalsBySeverity,
		},
		targetErrors: report.targetErrors,
	};

	if (report.filed) {
		const filing: FilingSummary = {filed: 0, touched: 0, resolved: 0};
		for (const {result} of report.reconciled) {
			filing.filed += result.created.length;
			filing.touched += result.touched;
			filing.resolved += result.resolved;
		}
		record.filing = filing;
	}

	return record;
}

/** A filesystem-safe filename for a run record from its timestamp. */
export function recordFilename(timestamp: string): string {
	return `${timestamp.replace(/[:.]/g, '-')}.json`;
}
