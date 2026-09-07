/**
 * File findings as issues: gate by the severity threshold, build issue content,
 * route to the audited repo (or the config repo when aggregating), and create
 * each issue through the injected {@link GitHubClient}.
 *
 * Dedup (task #7) will slot in front of the create call; this module is the
 * plain filing path it wraps.
 */

import type {SentinelConfig} from '../config/types.js';
import {findingHash} from '../dedup/hash.js';
import {upsertMarker} from '../dedup/markers.js';
import {type Finding, meetsSeverityThreshold} from '../findings/types.js';
import {buildIssueBody, buildIssueTitle} from './body.js';
import type {
	FilingContext,
	FilingResult,
	GitHubClient,
	IssueContent,
} from './types.js';

/** Findings at or above the configured filing threshold. */
export function qualifyingFindings(
	findings: Finding[],
	config: SentinelConfig,
): Finding[] {
	return findings.filter(finding =>
		meetsSeverityThreshold(finding.severity, config.severityThreshold),
	);
}

/** Which repository issues are filed on for this config. */
export function targetRepoFor(
	config: SentinelConfig,
	context: FilingContext,
): string {
	if (config.issues.aggregateToConfigRepo && context.configRepo) {
		return context.configRepo;
	}
	return context.auditedRepo;
}

/**
 * The markers that let a later run decide whether this issue's subject was
 * actually re-examined. The file is already in the body as prose, but prose is
 * not a contract — parsing it back would break the first time the template
 * changes, and the pack is not in the body at all.
 *
 * `pack` comes from {@link FilingContext} rather than the finding's rule
 * prefix: the rule is whatever the model wrote, and scope is keyed by the pack
 * that actually ran.
 */
export function withScopeMarkers(
	body: string,
	finding: Finding,
	context: FilingContext,
): string {
	const withPath = upsertMarker(body, 'path', finding.file);
	return context.pack === undefined
		? withPath
		: upsertMarker(withPath, 'pack', context.pack);
}

/** Render one finding into filable issue content. */
export function buildIssueContent(
	finding: Finding,
	config: SentinelConfig,
	context: FilingContext,
): IssueContent {
	const body = withScopeMarkers(
		upsertMarker(
			buildIssueBody(finding, context),
			'hash',
			findingHash(finding),
		),
		finding,
		context,
	);
	return {
		title: buildIssueTitle(finding),
		body,
		labels: [config.issues.label],
		assignees: config.issues.assignee ? [config.issues.assignee] : [],
	};
}

/**
 * File every qualifying finding. Findings below the threshold are returned in
 * `skipped`; a create that throws is captured in `errors` so one bad issue does
 * not abort the batch.
 */
export async function fileFindings(
	findings: Finding[],
	config: SentinelConfig,
	client: GitHubClient,
	context: FilingContext,
): Promise<FilingResult> {
	const targetRepo = targetRepoFor(config, context);
	const result: FilingResult = {targetRepo, filed: [], skipped: [], errors: []};

	for (const finding of findings) {
		if (!meetsSeverityThreshold(finding.severity, config.severityThreshold)) {
			result.skipped.push(finding);
			continue;
		}

		const content = buildIssueContent(finding, config, context);
		try {
			const issue = await client.createIssue({repo: targetRepo, ...content});
			result.filed.push({finding, issue});
		} catch (error) {
			result.errors.push({
				finding,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}
