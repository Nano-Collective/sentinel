import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import type {
	CreatedIssue,
	CreateIssueParams,
	ExistingIssue,
	ReconcileClient,
} from '../issues/types.js';
import type {ModelRunner, ModelRunResult} from '../orchestrator/types.js';
import type {SourceFile} from '../prompt/types.js';
import type {RulePack} from '../rule-packs/types.js';
import {runFromConfig, runLocal} from './run.js';
import type {LoadedPacks, PackLoader, RepoFiles} from './types.js';

console.log('\nrun/run.spec.ts');

const NOW = '2026-07-21T06:00:00.000Z';

const FINDING = {
	rule: 'p/r',
	file: 'src/a.ts',
	line_range: {start: 1, end: 2},
	category: 'security',
	severity: 'high',
	confidence: 'medium',
	offending_snippet: 'x',
};

function config(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
	return {
		targets: [{repo: 'my-org/a', rulePacks: ['p']}],
		schedule: '0 6 * * *',
		severityThreshold: 'medium',
		model: {provider: 'ollama', model: 'llama3.1'},
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: false},
		...overrides,
	};
}

function pack(name: string, dependsOn: string[] = []): RulePack {
	return {
		manifest: {
			name,
			version: '1.0.0',
			description: '',
			appliesTo: {paths: ['src/**/*.ts'], languages: ['typescript']},
			severityWeighting: {},
			dependsOn,
			category: 'security',
		},
		body: 'Flag bugs.',
	};
}

function findingRunner(output = JSON.stringify([FINDING])): ModelRunner {
	return {
		async run(): Promise<ModelRunResult> {
			return {ok: true, output};
		},
	};
}

function packLoader(loaded: LoadedPacks): PackLoader {
	return {
		async load(): Promise<LoadedPacks> {
			return loaded;
		},
	};
}

function repoFiles(overrideText: string | null = null): RepoFiles {
	return {
		async read(): Promise<SourceFile[]> {
			return [{path: 'src/a.ts', content: 'const x = 1;'}];
		},
		async readText(): Promise<string | null> {
			return overrideText;
		},
	};
}

function fakeClient() {
	const created: CreateIssueParams[] = [];
	const client: ReconcileClient = {
		async createIssue(params): Promise<CreatedIssue> {
			created.push(params);
			return {number: created.length, url: 'u'};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return [];
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};
	return {client, created};
}

const OPTIONS = {workspaceDir: '/ws', packsDir: '/cfg/rule-packs'};

test('audits a target and files issues when a client is present', async t => {
	const {client, created} = fakeClient();
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			client,
			now: NOW,
		},
		OPTIONS,
	);
	t.is(report.outcome.repos.length, 1);
	t.is(report.outcome.repos[0]?.packs[0]?.findings.length, 1);
	t.true(report.filed);
	t.is(report.reconciled.length, 1);
	t.is(created.length, 1);
	t.is(created[0]?.repo, 'my-org/a');
});

test('dry run audits but files nothing', async t => {
	const {client, created} = fakeClient();
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			client,
			now: NOW,
		},
		{...OPTIONS, dryRun: true},
	);
	t.false(report.filed);
	t.is(report.reconciled.length, 0);
	t.is(created.length, 0);
	// A dry run computes the preview (reading existing issues) without filing.
	t.is(report.previews.length, 1);
	t.is(report.previews[0]?.preview.wouldFileAsNew.length, 1);
	// The findings are still produced for the report.
	t.is(report.outcome.repos[0]?.packs[0]?.findings.length, 1);
});

test('with no client, findings are produced but not filed', async t => {
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			now: NOW,
		},
		OPTIONS,
	);
	t.false(report.filed);
	t.is(report.outcome.repos[0]?.packs[0]?.findings.length, 1);
});

test('records packs named by a target but absent from rule-packs', async t => {
	const report = await runFromConfig(
		config({targets: [{repo: 'my-org/a', rulePacks: ['p', 'ghost']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(report.outcome.repos[0]?.missingPacks, ['ghost']);
});

test('resolves depends_on so the dependency also runs', async t => {
	const report = await runFromConfig(
		config({targets: [{repo: 'my-org/a', rulePacks: ['p']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({
				packs: [pack('p', ['base']), pack('base')],
				errors: [],
			}),
			now: NOW,
		},
		OPTIONS,
	);
	const names = report.outcome.repos[0]?.packs
		.map(packOutcome => packOutcome.pack)
		.sort();
	t.deepEqual(names, ['base', 'p']);
});

test('applies a per-repo override to suppress a finding before filing', async t => {
	const override = 'suppress:\n  - paths: ["src/**"]\n    reason: generated\n';
	const {client, created} = fakeClient();
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(override),
			packs: packLoader({packs: [pack('p')], errors: []}),
			client,
			now: NOW,
		},
		OPTIONS,
	);
	t.is(created.length, 0);
	t.is(report.reconciled[0]?.result.suppressedByOverride, 1);
});

test('skips pattern targets in v1', async t => {
	const report = await runFromConfig(
		config({targets: [{pattern: 'my-org/*', rulePacks: ['p']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			now: NOW,
		},
		OPTIONS,
	);
	t.is(report.outcome.repos.length, 0);
});

test('runLocal audits a single pack and never files', async t => {
	const packText = `---\nname: p\nversion: 1.0.0\napplies_to:\n  paths: ["src/**/*.ts"]\ncategory: security\n---\nFlag bugs.\n`;
	const files: RepoFiles = {
		async read(): Promise<SourceFile[]> {
			return [{path: 'src/a.ts', content: 'x'}];
		},
		async readText(): Promise<string | null> {
			return packText;
		},
	};
	const outcome = await runLocal(
		'/packs/p.md',
		'/repo',
		{provider: 'ollama', model: 'llama3.1'},
		{runner: findingRunner(), files},
	);
	t.is(outcome.repos.length, 1);
	t.is(outcome.repos[0]?.packs[0]?.findings.length, 1);
});

test('runLocal throws on a missing pack file', async t => {
	const files: RepoFiles = {
		async read(): Promise<SourceFile[]> {
			return [];
		},
		async readText(): Promise<string | null> {
			return null;
		},
	};
	await t.throwsAsync(
		runLocal(
			'/nope.md',
			'/repo',
			{provider: 'o', model: 'm'},
			{runner: findingRunner(), files},
		),
		{message: /rule pack not found/},
	);
});

test('runLocal throws on an invalid pack file', async t => {
	const files: RepoFiles = {
		async read(): Promise<SourceFile[]> {
			return [];
		},
		async readText(): Promise<string | null> {
			return 'not a pack';
		},
	};
	await t.throwsAsync(
		runLocal(
			'/bad.md',
			'/repo',
			{provider: 'o', model: 'm'},
			{runner: findingRunner(), files},
		),
		{message: /invalid rule pack/},
	);
});
