/**
 * Issue filing types. Like the model runner, the GitHub side is an injectable
 * interface so the filing logic and the issue-body builder stay unit-testable
 * without hitting the API. The real client (gh-client.ts) is the only part that
 * shells out.
 */

import type {Finding} from '../findings/types.js';

/** The rendered content of one issue, before it is filed. */
export interface IssueContent {
	title: string;
	body: string;
	labels: string[];
	assignees: string[];
}

/** Parameters for creating one issue on a specific repository. */
export interface CreateIssueParams extends IssueContent {
	/** The `owner/name` repository to file on. */
	repo: string;
}

/** A created issue, as returned by the client. */
export interface CreatedIssue {
	number: number;
	url: string;
}

/** The GitHub operations issue filing needs. */
export interface GitHubClient {
	createIssue(params: CreateIssueParams): Promise<CreatedIssue>;
}

/** Context threaded into body building and routing. */
export interface FilingContext {
	/** The `owner/name` repository being audited. */
	auditedRepo: string;
	/** The config repo `owner/name`, for the footer link and aggregate routing. */
	configRepo?: string;
	/** The version of the rule pack that produced the finding, for the body. */
	packVersion?: string;
}

/** A finding paired with the issue it was filed as. */
export interface FiledIssue {
	finding: Finding;
	issue: CreatedIssue;
}

/** A finding whose filing threw. */
export interface FilingError {
	finding: Finding;
	error: string;
}

/** The outcome of filing a batch of findings. */
export interface FilingResult {
	/** The repository issues were filed on (audited or config repo). */
	targetRepo: string;
	filed: FiledIssue[];
	/** Findings below the severity threshold; not filed. */
	skipped: Finding[];
	errors: FilingError[];
}
