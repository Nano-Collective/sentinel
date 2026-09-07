import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import {readMarker} from '../dedup/markers.js';
import {lookup} from '../incremental/cache.js';
import {CacheSession} from '../incremental/session.js';
import {emptyCache} from '../incremental/types.js';
import type {
	CreatedIssue,
	CreateIssueParams,
	ExistingIssue,
	LabelFailure,
	ReconcileClient,
} from '../issues/types.js';
import type {ModelRunner, ModelRunResult} from '../orchestrator/types.js';
import type {SourceFile} from '../prompt/types.js';
import {matchesGlob} from '../rule-packs/glob.js';
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
		async ensureLabels(): Promise<LabelFailure[]> {
			return [];
		},
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

test('records a target error for a pattern with no repo lister', async t => {
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
	t.is(report.targetErrors.length, 1);
});

test('expands a pattern target via the repo lister and audits the matches', async t => {
	const report = await runFromConfig(
		config({targets: [{pattern: 'my-org/web-*', rulePacks: ['p']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			repoLister: {
				async list(): Promise<string[]> {
					return ['my-org/web-app', 'my-org/api', 'my-org/web-admin'];
				},
			},
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(report.outcome.repos.map(repo => repo.repo).sort(), [
		'my-org/web-admin',
		'my-org/web-app',
	]);
	t.deepEqual(report.targetErrors, []);
});

test('records a target error when a clone fails and skips the repo', async t => {
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			cloneRepo: async () => ({ok: false, skipped: false, error: 'no access'}),
			now: NOW,
		},
		OPTIONS,
	);
	t.is(report.outcome.repos.length, 0);
	t.true(report.targetErrors[0]?.includes('no access'));
});

test('clones a target when a cloner is provided', async t => {
	const cloned: string[] = [];
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p')], errors: []}),
			cloneRepo: async repo => {
				cloned.push(repo);
				return {ok: true, skipped: false};
			},
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(cloned, ['my-org/a']);
	t.is(report.outcome.repos.length, 1);
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
		['/packs/p.md'],
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
			['/nope.md'],
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
			['/bad.md'],
			'/repo',
			{provider: 'o', model: 'm'},
			{runner: findingRunner(), files},
		),
		{message: /invalid rule pack/},
	);
});

test('runLocal runs every pack it is given, in order', async t => {
	// The bug behind #3: --rule-pack was documented as the way to choose packs
	// in local mode but the parser kept one value, so only the last ever ran.
	const bodies: Record<string, string> = {
		'/packs/a.md':
			'---\nname: a\nversion: 1.0.0\ndescription: d\ncategory: security\napplies_to:\n  paths: ["src/**/*.ts"]\n  languages: [typescript]\n---\nFlag bugs.\n',
		'/packs/b.md':
			'---\nname: b\nversion: 2.0.0\ndescription: d\ncategory: security\napplies_to:\n  paths: ["lib/**/*.ts"]\n  languages: [typescript]\n---\nFlag bugs.\n',
	};
	const requested: string[] = [];
	const files: RepoFiles = {
		async read(_dir: string, patterns: string[]): Promise<SourceFile[]> {
			requested.push(patterns.join(','));
			return [{path: 'src/a.ts', content: 'x'}];
		},
		async readText(path: string): Promise<string | null> {
			return bodies[path] ?? null;
		},
	};

	const outcome = await runLocal(
		['/packs/a.md', '/packs/b.md'],
		'/repo',
		{provider: 'ollama', model: 'llama3.1'},
		{runner: findingRunner(), files},
	);

	t.is(outcome.repos.length, 1);
	t.deepEqual(
		outcome.repos[0]?.packs.map(packOutcome => packOutcome.pack),
		['a', 'b'],
	);
	// Each pack is scoped by its own applies_to rather than a shared union.
	t.deepEqual(requested, ['src/**/*.ts', 'lib/**/*.ts']);
});

test('runLocal with no packs audits nothing rather than throwing', async t => {
	const outcome = await runLocal(
		[],
		'/repo',
		{provider: 'o', model: 'm'},
		{runner: findingRunner(), files: repoFiles()},
	);
	t.is(outcome.repos[0]?.packs.length, 0);
});

test('runLocal names the offending pack when one of several is invalid', async t => {
	const bodies: Record<string, string> = {
		'/packs/a.md':
			'---\nname: a\nversion: 1.0.0\ndescription: d\ncategory: security\napplies_to:\n  paths: ["src/**/*.ts"]\n  languages: [typescript]\n---\nFlag bugs.\n',
		'/packs/bad.md': 'not a pack',
	};
	const files: RepoFiles = {
		async read(): Promise<SourceFile[]> {
			return [{path: 'src/a.ts', content: 'x'}];
		},
		async readText(path: string): Promise<string | null> {
			return bodies[path] ?? null;
		},
	};
	await t.throwsAsync(
		runLocal(
			['/packs/a.md', '/packs/bad.md'],
			'/repo',
			{provider: 'o', model: 'm'},
			{runner: findingRunner(), files},
		),
		{message: /invalid rule pack \/packs\/bad\.md/},
	);
});

test('an unresolvable pack chain is reported apart from a missing pack', async t => {
	const report = await runFromConfig(
		config({targets: [{repo: 'my-org/a', rulePacks: ['p', 'ghost']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			// `p` is present but depends on a pack that is not.
			packs: packLoader({packs: [pack('p', ['absent'])], errors: []}),
			now: NOW,
		},
		OPTIONS,
	);
	const outcome = report.outcome.repos[0];
	t.deepEqual(outcome?.missingPacks, ['ghost']);
	t.is(outcome?.unresolvedPacks.length, 1);
	t.is(outcome?.unresolvedPacks[0]?.pack, 'p');
	// Neither pack ran.
	t.is(outcome?.packs.length, 0);
});

test('pack load errors reach the run report', async t => {
	const report = await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({
				packs: [pack('p')],
				errors: [
					{file: 'broken.md', errors: [{field: 'name', message: 'missing'}]},
				],
			}),
			now: NOW,
		},
		OPTIONS,
	);
	t.is(report.packLoadErrors.length, 1);
	t.is(report.packLoadErrors[0]?.file, 'broken.md');
});

test('a dry run carries pack-selection problems into the preview', async t => {
	const {client} = fakeClient();
	const report = await runFromConfig(
		config({targets: [{repo: 'my-org/a', rulePacks: ['p', 'ghost']}]}),
		{
			runner: findingRunner(),
			files: repoFiles(),
			packs: packLoader({packs: [pack('p', ['absent'])], errors: []}),
			client,
			now: NOW,
		},
		{...OPTIONS, dryRun: true},
	);
	t.deepEqual(report.previews[0]?.missingPacks, ['ghost']);
	t.is(report.previews[0]?.unresolvedPacks[0]?.pack, 'p');
});

test('runLocal reports no pack-selection problems', async t => {
	const outcome = await runLocal(
		['/cfg/rule-packs/p.md'],
		'/ws/a',
		{provider: 'ollama', model: 'llama3.1'},
		{
			runner: findingRunner(),
			files: {
				async read(): Promise<SourceFile[]> {
					return [{path: 'src/a.ts', content: 'const x = 1;'}];
				},
				async readText(): Promise<string | null> {
					return '---\nname: p\nversion: 1.0.0\ndescription: d\ncategory: security\napplies_to:\n  paths: ["src/**/*.ts"]\n  languages: [typescript]\n---\nFlag bugs.\n';
				},
			},
		},
	);
	t.deepEqual(outcome.repos[0]?.unresolvedPacks, []);
	t.deepEqual(outcome.repos[0]?.missingPacks, []);
});

test('a filed issue is attributed to the pack that produced it', async t => {
	// The integration proof that the plumbing is connected: the pack name only
	// exists in the per-pack outcomes, and the findings are flat by the time
	// reconciliation sees them. If the run does not carry the attribution across
	// that flattening, every issue files unmarked and every later partial run
	// holds everything forever.
	const {client, created} = fakeClient();
	await runFromConfig(
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
	t.is(readMarker(created[0]?.body ?? '', 'pack'), 'p');
	t.not(readMarker(created[0]?.body ?? '', 'path'), null);
});

test('a config-driven run holds nothing, because it reads everything', async t => {
	const {client} = fakeClient();
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
	t.is(report.reconciled[0]?.result.held, 0);
});

/** RepoFiles that serve a fixed file list and record every read's patterns. */
function recordingFiles(files: SourceFile[]) {
	const reads: string[][] = [];
	const repoFilesImpl: RepoFiles = {
		async read(_dir, patterns): Promise<SourceFile[]> {
			reads.push(patterns);
			return files.filter(
				file =>
					patterns.length === 0 ||
					patterns.some(pattern => matchesGlob(pattern, file.path)),
			);
		},
		async readText(): Promise<string | null> {
			return null;
		},
	};
	return {files: repoFilesImpl, reads};
}

function cacheSession(changed: string[] | null, head = 'sha-new') {
	return new CacheSession(emptyCache(), {
		head: () => head,
		changedSince: () => changed,
	});
}

const INCREMENTAL_CONFIG = config({
	targets: [{repo: 'my-org/a', rulePacks: ['p'], incremental: true}],
});

test('the first run has no cache, so it reads everything', async t => {
	const {files, reads} = recordingFiles([
		{path: 'src/a.ts', content: 'a'},
		{path: 'src/b.ts', content: 'b'},
	]);
	const cache = cacheSession([]);
	const report = await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache,
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(reads, [['src/**/*.ts']], 'one union read of the pack patterns');
	t.is(report.outcome.repos[0]?.packs[0]?.findings.length, 1);
});

test('a completed pass records the commit for next time', async t => {
	const {files} = recordingFiles([{path: 'src/a.ts', content: 'a'}]);
	const cache = cacheSession([]);
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache,
			now: NOW,
		},
		OPTIONS,
	);
	t.is(lookup(cache.result(), 'my-org/a', 'p')?.sha, 'sha-new');
});

test('a pack whose audit failed records nothing', async t => {
	// Recording a commit for a pass that errored would let the next run skip
	// files on the strength of an audit that never happened.
	const {files} = recordingFiles([{path: 'src/a.ts', content: 'a'}]);
	const cache = cacheSession([]);
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: {
				async run(): Promise<ModelRunResult> {
					return {ok: false, output: '', error: 'model exploded'};
				},
			},
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache,
			now: NOW,
		},
		OPTIONS,
	);
	t.is(lookup(cache.result(), 'my-org/a', 'p'), undefined);
});

test('a second run reads only what changed, and holds nothing it did read', async t => {
	const all = [
		{path: 'src/a.ts', content: 'a'},
		{path: 'src/b.ts', content: 'b'},
	];
	// Seed the cache as a completed first pass would have left it.
	const first = cacheSession([], 'sha-1');
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);

	const {files, reads} = recordingFiles(all);
	const second = new CacheSession(first.result(), {
		head: () => 'sha-2',
		changedSince: () => ['src/b.ts'],
	});
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: second,
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(reads, [['src/b.ts']], 'only the changed file is read');
});

test('a target that did not opt in is never incremental', async t => {
	const all = [
		{path: 'src/a.ts', content: 'a'},
		{path: 'src/b.ts', content: 'b'},
	];
	const first = cacheSession([], 'sha-1');
	await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);

	const {files, reads} = recordingFiles(all);
	await runFromConfig(
		config(),
		{
			runner: findingRunner(),
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: new CacheSession(first.result(), {
				head: () => 'sha-2',
				changedSince: () => ['src/b.ts'],
			}),
			now: NOW,
		},
		OPTIONS,
	);
	t.deepEqual(reads, [['src/**/*.ts']], 'still a full union read');
});

test('--full overrides a warm cache', async t => {
	const all = [{path: 'src/a.ts', content: 'a'}];
	const first = cacheSession([], 'sha-1');
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);

	const {files, reads} = recordingFiles(all);
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: new CacheSession(first.result(), {
				head: () => 'sha-2',
				changedSince: () => [],
			}),
			now: NOW,
		},
		{...OPTIONS, full: true},
	);
	t.deepEqual(reads, [['src/**/*.ts']]);
});

test('an incremental run holds the issues whose files it skipped', async t => {
	// The acceptance property, end to end: a repo audited incrementally, an open
	// issue against a file this run did not read, and no ageing of that issue.
	const all = [
		{path: 'src/a.ts', content: 'a'},
		{path: 'src/b.ts', content: 'b'},
	];
	const first = cacheSession([], 'sha-1');
	const {client: firstClient, created} = fakeClient();
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			client: firstClient,
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);
	const filed = created[0];
	t.truthy(filed, 'the first run filed an issue');
	t.is(readMarker(filed?.body ?? '', 'pack'), 'p');

	// Second run: the finding's file is unchanged, so the pack never reads it.
	// The finding is therefore absent — and must not be read as fixed.
	const existing: ExistingIssue[] = [
		{
			number: 1,
			url: 'u',
			state: 'open',
			labels: ['sentinel'],
			body: filed?.body ?? '',
		},
	];
	const secondClient: ReconcileClient = {
		async ensureLabels(): Promise<LabelFailure[]> {
			return [];
		},
		async createIssue(): Promise<CreatedIssue> {
			return {number: 2, url: 'u'};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return existing;
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};
	const report = await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: {
				async run(): Promise<ModelRunResult> {
					return {ok: true, output: '[]'};
				},
			},
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			client: secondClient,
			cache: new CacheSession(first.result(), {
				head: () => 'sha-2',
				changedSince: () => ['src/other.ts'],
			}),
			now: NOW,
		},
		{...OPTIONS, resolveAfterMisses: 1},
	);

	const result = report.reconciled[0]?.result;
	t.is(result?.held, 1, 'held');
	t.is(result?.incremented, 0, 'not aged');
	t.is(result?.resolved, 0, 'and not closed, even at a threshold of 1');
});

test('a pack with nothing changed reads nothing and calls no model', async t => {
	// The bug this guards: `RepoFiles.read` treats an empty pattern list as "the
	// whole repository", so a pack with nothing to re-read would read everything
	// and then record a scope claiming it had — incremental scanning becoming a
	// silent no-op on the commonest case of all.
	const all = [
		{path: 'src/a.ts', content: 'a'},
		{path: 'src/b.ts', content: 'b'},
	];
	const first = cacheSession([], 'sha-1');
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);

	const {files, reads} = recordingFiles(all);
	let modelCalls = 0;
	const report = await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: {
				async run(): Promise<ModelRunResult> {
					modelCalls++;
					return {ok: true, output: JSON.stringify([FINDING])};
				},
			},
			files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			cache: new CacheSession(first.result(), {
				head: () => 'sha-2',
				changedSince: () => [],
			}),
			now: NOW,
		},
		OPTIONS,
	);

	t.deepEqual(reads, [], 'no read at all');
	t.is(modelCalls, 0, 'and no model call');
	t.is(report.outcome.repos[0]?.packs[0]?.findings.length, 0);
	t.true(report.outcome.repos[0]?.packs[0]?.ok, 'the pass completed');
});

test('a pack that scanned nothing holds every one of its issues', async t => {
	// The other half of the same bug. If the empty read had returned the whole
	// repo, the scope would claim every file was scanned and nothing would be
	// held — so an unchanged repo would age out its own open findings.
	const all = [{path: 'src/a.ts', content: 'a'}];
	const first = cacheSession([], 'sha-1');
	const {client: firstClient, created} = fakeClient();
	await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			client: firstClient,
			cache: first,
			now: NOW,
		},
		OPTIONS,
	);

	const existing: ExistingIssue[] = [
		{
			number: 1,
			url: 'u',
			state: 'open',
			labels: ['sentinel'],
			body: created[0]?.body ?? '',
		},
	];
	const client: ReconcileClient = {
		async ensureLabels(): Promise<LabelFailure[]> {
			return [];
		},
		async createIssue(): Promise<CreatedIssue> {
			return {number: 2, url: 'u'};
		},
		async listIssues(): Promise<ExistingIssue[]> {
			return existing;
		},
		async updateIssue(): Promise<void> {},
		async closeIssue(): Promise<void> {},
	};
	const report = await runFromConfig(
		INCREMENTAL_CONFIG,
		{
			runner: findingRunner(),
			files: recordingFiles(all).files,
			packs: packLoader({packs: [pack('p')], errors: []}),
			client,
			cache: new CacheSession(first.result(), {
				head: () => 'sha-2',
				changedSince: () => [],
			}),
			now: NOW,
		},
		{...OPTIONS, resolveAfterMisses: 1},
	);
	t.is(report.reconciled[0]?.result.held, 1);
	t.is(report.reconciled[0]?.result.resolved, 0);
});
