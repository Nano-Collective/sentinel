/**
 * The dedup executor. Fetches existing Sentinel issues on the target repo,
 * plans the reconciliation, then applies it: file new findings, touch matched
 * issues (reset misses + last-seen), age out absent ones, and auto-resolve the
 * stale. Below-threshold findings are filtered out before planning, so they
 * neither create nor touch.
 */

import type {RepoOverride, SentinelConfig} from '../config/types.js';
import {type Finding, meetsSeverityThreshold} from '../findings/types.js';
import {buildIssueContent, targetRepoFor} from '../issues/file.js';
import type {
	CreatedIssue,
	FilingContext,
	ReconcileClient,
} from '../issues/types.js';
import {applyRepoOverride} from '../suppression/apply.js';
import {upsertMarker} from './markers.js';
import {
	planReconciliation,
	type ReconcileOptions,
	SUPPRESSION_LABELS,
} from './plan.js';

/** A summary of what one reconcile run did. */
export interface ReconcileResult {
	targetRepo: string;
	created: CreatedIssue[];
	touched: number;
	incremented: number;
	resolved: number;
	/** Findings suppressed by a label-closed issue (dedup layer). */
	suppressed: number;
	/** Findings removed by the per-repo override's suppress rules. */
	suppressedByOverride: number;
	/** Per-operation failures that were tolerated (create/update/close). */
	errors: string[];
}

function trackedBody(body: string, now: string): string {
	return upsertMarker(upsertMarker(body, 'last-seen', now), 'misses', '0');
}

/** Run a mutation, recording (not throwing) its failure so the run continues. */
async function tolerate(
	errors: string[],
	label: string,
	op: () => Promise<void>,
): Promise<void> {
	try {
		await op();
	} catch (error) {
		errors.push(
			`${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Reconcile this run's findings against the issues already on the target repo.
 * `now` is passed in (ISO string) so the executor stays deterministic.
 */
export async function reconcileFindings(
	findings: Finding[],
	config: SentinelConfig,
	client: ReconcileClient,
	context: FilingContext,
	now: string,
	options: ReconcileOptions = {},
	override?: RepoOverride,
): Promise<ReconcileResult> {
	const targetRepo = targetRepoFor(config, context);
	const existing = await client.listIssues({
		repo: targetRepo,
		label: config.issues.label,
	});

	// Layer 3: apply the per-repo override (threshold + suppress rules), then
	// gate by the effective threshold before planning.
	const {
		kept,
		suppressed: overrideSuppressed,
		threshold,
	} = applyRepoOverride(findings, config, override);
	const qualifying = kept.filter(finding =>
		meetsSeverityThreshold(finding.severity, threshold),
	);
	const plan = planReconciliation(qualifying, existing, options);
	const errors: string[] = [];

	// Sentinel's own labels must exist before filing or GitHub rejects them.
	if (plan.toCreate.length > 0) {
		await tolerate(errors, 'ensure labels', () =>
			client.ensureLabels({
				repo: targetRepo,
				labels: [config.issues.label, ...SUPPRESSION_LABELS],
			}),
		);
	}

	const created: CreatedIssue[] = [];
	for (const finding of plan.toCreate) {
		const content = buildIssueContent(finding, config, context);
		try {
			created.push(
				await client.createIssue({
					repo: targetRepo,
					...content,
					body: trackedBody(content.body, now),
				}),
			);
		} catch (error) {
			errors.push(
				`create (${finding.file}): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	let touched = 0;
	for (const {issue} of plan.toTouch) {
		await tolerate(errors, `touch #${issue.number}`, async () => {
			await client.updateIssue({
				repo: targetRepo,
				number: issue.number,
				body: trackedBody(issue.body, now),
			});
			touched++;
		});
	}

	let incremented = 0;
	for (const {issue, misses} of plan.toIncrementMiss) {
		await tolerate(errors, `age #${issue.number}`, async () => {
			await client.updateIssue({
				repo: targetRepo,
				number: issue.number,
				body: upsertMarker(issue.body, 'misses', String(misses)),
			});
			incremented++;
		});
	}

	let resolved = 0;
	for (const issue of plan.toResolve) {
		await tolerate(errors, `resolve #${issue.number}`, async () => {
			await client.closeIssue({
				repo: targetRepo,
				number: issue.number,
				reason: 'completed',
				comment:
					'Sentinel is auto-resolving this finding: it has not recurred across recent audit runs.',
			});
			resolved++;
		});
	}

	return {
		targetRepo,
		created,
		touched,
		incremented,
		resolved,
		suppressed: plan.suppressed.length,
		suppressedByOverride: overrideSuppressed.length,
		errors,
	};
}
