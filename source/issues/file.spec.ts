import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import type {Finding, Severity} from '../findings/types.js';
import {
	buildIssueContent,
	fileFindings,
	qualifyingFindings,
	targetRepoFor,
} from './file.js';
import type {CreatedIssue, CreateIssueParams, GitHubClient} from './types.js';

console.log('\nissues/file.spec.ts');

function config(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
	return {
		targets: [{repo: 'my-org/my-program', rulePacks: ['p']}],
		schedule: '0 6 * * *',
		severityThreshold: 'medium',
		model: {provider: 'ollama', model: 'llama3.1'},
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: false},
		...overrides,
	};
}

function finding(severity: Severity, file = 'a.rs'): Finding {
	return {
		rule: 'p/r',
		file,
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity,
		confidence: 'high',
		offendingSnippet: 'x',
	};
}

/** A client that records created issues and hands back sequential numbers. */
function fakeClient(): GitHubClient & {created: CreateIssueParams[]} {
	return {
		created: [],
		async createIssue(params): Promise<CreatedIssue> {
			this.created.push(params);
			const number = this.created.length;
			return {
				number,
				url: `https://github.com/${params.repo}/issues/${number}`,
			};
		},
	};
}

const CTX = {auditedRepo: 'my-org/my-program', configRepo: 'my-org/config'};

test('qualifyingFindings keeps only findings at or above the threshold', t => {
	const findings = [
		finding('low'),
		finding('medium'),
		finding('high'),
		finding('critical'),
	];
	const kept = qualifyingFindings(
		findings,
		config({severityThreshold: 'high'}),
	);
	t.deepEqual(
		kept.map(f => f.severity),
		['high', 'critical'],
	);
});

test('targetRepoFor routes to the audited repo by default', t => {
	t.is(targetRepoFor(config(), CTX), 'my-org/my-program');
});

test('targetRepoFor routes to the config repo when aggregating', t => {
	const cfg = config({
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: true},
	});
	t.is(targetRepoFor(cfg, CTX), 'my-org/config');
});

test('targetRepoFor falls back to audited repo if aggregating with no config repo', t => {
	const cfg = config({
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: true},
	});
	t.is(
		targetRepoFor(cfg, {auditedRepo: 'my-org/my-program'}),
		'my-org/my-program',
	);
});

test('buildIssueContent applies the configured label and assignee', t => {
	const cfg = config({
		issues: {label: 'audit', assignee: 'octocat', aggregateToConfigRepo: false},
	});
	const content = buildIssueContent(finding('high'), cfg, CTX);
	t.deepEqual(content.labels, ['audit']);
	t.deepEqual(content.assignees, ['octocat']);
	t.truthy(content.title);
	t.truthy(content.body);
});

test('fileFindings files qualifying findings and skips the rest', async t => {
	const client = fakeClient();
	const result = await fileFindings(
		[finding('low', 'low.rs'), finding('high', 'high.rs')],
		config({severityThreshold: 'medium'}),
		client,
		CTX,
	);
	t.is(result.filed.length, 1);
	t.is(result.skipped.length, 1);
	t.is(result.filed[0]?.finding.file, 'high.rs');
	t.is(result.skipped[0]?.file, 'low.rs');
	t.is(result.targetRepo, 'my-org/my-program');
	t.is(client.created[0]?.repo, 'my-org/my-program');
});

test('fileFindings routes to the config repo when aggregating', async t => {
	const client = fakeClient();
	const cfg = config({
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: true},
	});
	const result = await fileFindings([finding('high')], cfg, client, CTX);
	t.is(result.targetRepo, 'my-org/config');
	t.is(client.created[0]?.repo, 'my-org/config');
});

test('fileFindings captures a create failure without aborting the batch', async t => {
	const client: GitHubClient = {
		async createIssue(params) {
			if (params.title.includes('boom')) {
				throw new Error('API rate limited');
			}
			return {number: 1, url: 'u'};
		},
	};
	const findings = [
		{...finding('high', 'ok.rs'), summary: 'fine'},
		{...finding('high', 'bad.rs'), summary: 'boom'},
	];
	const result = await fileFindings(findings, config(), client, CTX);
	t.is(result.filed.length, 1);
	t.is(result.errors.length, 1);
	t.is(result.errors[0]?.error, 'API rate limited');
	t.is(result.errors[0]?.finding.file, 'bad.rs');
});
