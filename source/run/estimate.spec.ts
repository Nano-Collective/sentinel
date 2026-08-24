import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import type {RunRecord, RunUsage} from '../observe/types.js';
import type {SourceFile} from '../prompt/types.js';
import type {RulePack} from '../rule-packs/types.js';
import type {PrepareResult} from './clone.js';
import {
	type AuditEstimate,
	calibrate,
	estimateRun,
	estimateTokens,
	renderEstimate,
} from './estimate.js';
import type {RepoLister} from './repo-lister.js';
import type {LoadedPacks, PackLoader, RepoFiles} from './types.js';

console.log('\nrun/estimate.spec.ts');

const TS = '2026-07-21T06:00:00.000Z';

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

function packLoader(loaded: LoadedPacks): PackLoader {
	return {
		async load(): Promise<LoadedPacks> {
			return loaded;
		},
	};
}

function repoFiles(files: SourceFile[]): RepoFiles {
	return {
		async read(): Promise<SourceFile[]> {
			return files;
		},
		async readText(): Promise<string | null> {
			return null;
		},
	};
}

const FILES: SourceFile[] = [
	{path: 'src/a.ts', content: 'const x = 1;'},
	{path: 'src/b.ts', content: 'const y = 2;'},
];

const OPTIONS = {workspaceDir: '/ws', packsDir: '/cfg/rule-packs'};

function record(usage: RunUsage | undefined, passes: number): RunRecord {
	return {
		timestamp: TS,
		mode: 'live',
		repos: [
			{
				repo: 'my-org/a',
				findings: 0,
				bySeverity: {low: 0, medium: 0, high: 0, critical: 0},
				packs: Array.from({length: passes}, () => ({
					pack: 'p',
					version: '1.0.0',
					findings: 0,
					ok: true,
				})),
			},
		],
		totals: {
			repos: 1,
			findings: 0,
			bySeverity: {low: 0, medium: 0, high: 0, critical: 0},
			usage,
		},
		targetErrors: [],
	};
}

// --- estimateTokens ---------------------------------------------------------

test('estimateTokens approximates four characters to a token', t => {
	t.is(estimateTokens(''), 0);
	t.is(estimateTokens('abcd'), 1);
	// Rounds up: a partial token is still a token.
	t.is(estimateTokens('abcde'), 2);
});

// --- calibrate --------------------------------------------------------------

test('calibrate falls back to built-in figures without records', t => {
	const calibration = calibrate([]);
	t.is(calibration.samples, 0);
	t.true(calibration.msPerRequest > 0);
	t.true(calibration.requestsPerPass >= 1);
	t.true(calibration.outputTokensPerRequest > 0);
});

test('calibrate derives per-request figures from recorded usage', t => {
	const calibration = calibrate([
		record(
			{requests: 4, durationMs: 40_000, promptTokens: 8000, outputTokens: 800},
			4,
		),
	]);
	t.is(calibration.samples, 1);
	t.is(calibration.msPerRequest, 10_000);
	t.is(calibration.outputTokensPerRequest, 200);
	t.is(calibration.requestsPerPass, 1);
});

test('calibrate reflects auto-fix retries in requests per pass', t => {
	// Six requests across four pack passes: retries are part of the cost.
	const calibration = calibrate([
		record(
			{requests: 6, durationMs: 60_000, promptTokens: 9000, outputTokens: 600},
			4,
		),
	]);
	t.is(calibration.requestsPerPass, 1.5);
});

test('calibrate skips records with no usage or no requests', t => {
	const calibration = calibrate([
		record(undefined, 2),
		record({requests: 0, durationMs: 0, promptTokens: 0, outputTokens: 0}, 2),
	]);
	t.is(calibration.samples, 0);
});

test('calibrate averages the most recent records', t => {
	const older = record(
		{requests: 1, durationMs: 30_000, promptTokens: 100, outputTokens: 100},
		1,
	);
	older.timestamp = '2026-07-20T06:00:00.000Z';
	const newer = record(
		{requests: 1, durationMs: 10_000, promptTokens: 100, outputTokens: 300},
		1,
	);
	const calibration = calibrate([newer, older]);
	t.is(calibration.samples, 2);
	t.is(calibration.msPerRequest, 20_000);
	t.is(calibration.outputTokensPerRequest, 200);
});

test('calibrate never reports fewer than one request per pass', t => {
	// A record whose repos carry more packs than requests (a partial run).
	const calibration = calibrate([
		record(
			{requests: 1, durationMs: 5000, promptTokens: 100, outputTokens: 100},
			4,
		),
	]);
	t.is(calibration.requestsPerPass, 1);
});

test('calibrate keeps to the most recent window of records', t => {
	const records = Array.from({length: 14}, (_, i) => {
		const entry = record(
			{requests: 1, durationMs: 1000, promptTokens: 100, outputTokens: 100},
			1,
		);
		entry.timestamp = `2026-07-${String(i + 1).padStart(2, '0')}T06:00:00.000Z`;
		return entry;
	});
	t.is(calibrate(records).samples, 10);
});

test('calibrate keeps the default retry rate when a record has no passes', t => {
	const calibration = calibrate([
		record(
			{requests: 2, durationMs: 4000, promptTokens: 200, outputTokens: 200},
			0,
		),
	]);
	t.is(calibration.msPerRequest, 2000);
	t.is(calibration.requestsPerPass, calibrate([]).requestsPerPass);
});

// --- estimateRun ------------------------------------------------------------

test('estimates a target from the prompts an audit would send', async t => {
	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	t.is(estimate.totals.repos, 1);
	t.is(estimate.totals.rulePacks, 1);
	t.is(estimate.totals.files, 2);
	t.true(estimate.totals.requests >= 1);
	t.true(estimate.totals.tokens > 0);
	t.true(estimate.totals.durationMs > 0);
	t.deepEqual(estimate.repos[0]?.packs, ['p']);
	t.is(estimate.repos[0]?.files, 2);
});

test('counts a pack dependency chain as extra passes', async t => {
	const one = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	const two = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({
				packs: [pack('p', ['base']), pack('base')],
				errors: [],
			}),
		},
		OPTIONS,
	);
	t.is(two.totals.rulePacks, 2);
	t.is(two.repos[0]?.packs.length, 2);
	t.true(two.totals.requests > one.totals.requests);
	t.true(two.totals.tokens > one.totals.tokens);
});

test('only counts files a pack actually sends', async t => {
	const estimate = await estimateRun(
		config(),
		{
			// README.md is outside the pack's applies_to scope.
			files: repoFiles([...FILES, {path: 'README.md', content: '# hi'}]),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	t.is(estimate.totals.files, 2);
});

test('a bigger repository estimates more tokens', async t => {
	const small = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	const large = await estimateRun(
		config(),
		{
			files: repoFiles([{path: 'src/a.ts', content: 'x'.repeat(40_000)}]),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	t.true(large.totals.tokens > small.totals.tokens);
});

test('reports packs the rule-packs directory does not have', async t => {
	const estimate = await estimateRun(
		config({targets: [{repo: 'my-org/a', rulePacks: ['p', 'gone']}]}),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	t.deepEqual(estimate.repos[0]?.missingPacks, ['gone']);
	t.is(estimate.repos[0]?.packs.length, 1);
});

test('carries pack load errors through to the estimate', async t => {
	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({
				packs: [pack('p')],
				errors: [{file: 'broken.md', errors: []}],
			}),
		},
		OPTIONS,
	);
	t.is(estimate.packLoadErrors.length, 1);
});

test('expands pattern targets through the repo lister', async t => {
	const lister: RepoLister = {
		async list(): Promise<string[]> {
			return ['my-org/web-one', 'my-org/web-two', 'my-org/api'];
		},
	};
	const estimate = await estimateRun(
		config({targets: [{pattern: 'my-org/web-*', rulePacks: ['p']}]}),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
			repoLister: lister,
		},
		OPTIONS,
	);
	t.is(estimate.totals.repos, 2);
});

test('records a target that could not be expanded', async t => {
	const estimate = await estimateRun(
		config({targets: [{pattern: 'my-org/web-*', rulePacks: ['p']}]}),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
	t.is(estimate.totals.repos, 0);
	t.is(estimate.targetErrors.length, 1);
});

test('clones missing repos when a cloner is supplied', async t => {
	const cloned: string[] = [];
	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
			async cloneRepo(repo): Promise<PrepareResult> {
				cloned.push(repo);
				return {ok: true, skipped: false};
			},
		},
		OPTIONS,
	);
	t.deepEqual(cloned, ['my-org/a']);
	t.is(estimate.totals.repos, 1);
});

test('skips a repo that could not be checked out', async t => {
	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
			async cloneRepo(): Promise<PrepareResult> {
				return {ok: false, skipped: false, error: 'no such repo'};
			},
		},
		OPTIONS,
	);
	t.is(estimate.totals.repos, 0);
	t.true(estimate.targetErrors[0]?.includes('no such repo'));
});

test('uses recorded usage instead of the built-in defaults', async t => {
	const deps = {
		files: repoFiles(FILES),
		packs: packLoader({packs: [pack('p')], errors: []}),
	};
	const uncalibrated = await estimateRun(config(), deps, OPTIONS);
	const calibrated = await estimateRun(
		config(),
		{
			...deps,
			records: [
				record(
					{
						requests: 1,
						durationMs: 5000,
						promptTokens: 100,
						outputTokens: 100,
					},
					1,
				),
			],
		},
		OPTIONS,
	);
	t.is(calibrated.calibration.samples, 1);
	t.is(calibrated.totals.durationMs, 5000);
	t.not(calibrated.totals.durationMs, uncalibrated.totals.durationMs);
});

test('a repo audited by two targets is counted once', async t => {
	const estimate = await estimateRun(
		config({
			targets: [
				{repo: 'my-org/a', rulePacks: ['p']},
				{repo: 'my-org/a', rulePacks: ['q']},
			],
		}),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p'), pack('q')], errors: []}),
		},
		OPTIONS,
	);
	t.is(estimate.totals.repos, 1);
	t.is(estimate.totals.rulePacks, 2);
	t.is(estimate.repos[0]?.packs.length, 2);
});

// --- renderEstimate ---------------------------------------------------------

async function estimateOf(
	overrides: Partial<SentinelConfig> = {},
	files: SourceFile[] = FILES,
): Promise<AuditEstimate> {
	return estimateRun(
		config(overrides),
		{
			files: repoFiles(files),
			packs: packLoader({packs: [pack('p')], errors: []}),
		},
		OPTIONS,
	);
}

test('renders the headline figures the issue asks for', async t => {
	const markdown = renderEstimate(await estimateOf());
	t.true(markdown.startsWith('# Sentinel audit estimate'));
	t.true(markdown.includes('**Repositories:** 1'));
	t.true(markdown.includes('**Rule packs:** 1'));
	t.true(markdown.includes('**Files:** 2'));
	t.true(markdown.includes('**Estimated AI requests:**'));
	t.true(markdown.includes('**Estimated tokens:**'));
	t.true(markdown.includes('**Estimated runtime:**'));
	t.true(markdown.includes('| `my-org/a` |'));
});

test('says when the figures are built-in rather than calibrated', async t => {
	t.true(renderEstimate(await estimateOf()).includes('No run records yet'));
});

test('names the record count once calibrated', async t => {
	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
			records: [
				record(
					{
						requests: 2,
						durationMs: 20_000,
						promptTokens: 400,
						outputTokens: 200,
					},
					2,
				),
			],
		},
		OPTIONS,
	);
	t.true(renderEstimate(estimate).includes('Calibrated from the last 1 run'));
});

test('renders large figures compactly', t => {
	const markdown = renderEstimate({
		repos: [
			{
				repo: 'my-org/a',
				packs: ['p'],
				files: 1204,
				requests: 420,
				tokens: 3_800_000,
				durationMs: 14 * 60_000,
				missingPacks: [],
			},
		],
		totals: {
			repos: 18,
			rulePacks: 5,
			files: 1204,
			requests: 420,
			tokens: 3_800_000,
			durationMs: 14 * 60_000,
		},
		calibration: {
			msPerRequest: 2000,
			requestsPerPass: 1,
			outputTokensPerRequest: 700,
			samples: 3,
		},
		packLoadErrors: [],
		targetErrors: [],
	});
	t.true(markdown.includes('**Files:** 1,204'));
	t.true(markdown.includes('~420'));
	t.true(markdown.includes('~3.8M'));
	t.true(markdown.includes('~14 minute(s)'));
});

test('renders seconds, minutes, and hours as an operator reads them', t => {
	const of = (durationMs: number, tokens: number): string =>
		renderEstimate({
			repos: [],
			totals: {
				repos: 0,
				rulePacks: 0,
				files: 0,
				requests: 0,
				tokens,
				durationMs,
			},
			calibration: {
				msPerRequest: 0,
				requestsPerPass: 1,
				outputTokensPerRequest: 0,
				samples: 1,
			},
			packLoadErrors: [],
			targetErrors: [],
		});
	t.true(of(45_000, 800).includes('~45 second(s)'));
	t.true(of(45_000, 800).includes('~800'));
	t.true(of(20 * 60_000, 41_200).includes('~20 minute(s)'));
	t.true(of(20 * 60_000, 41_200).includes('~41.2K'));
	t.true(of(3 * 3_600_000, 0).includes('~3 hour(s)'));
	t.true(
		of(2 * 3_600_000 + 30 * 60_000, 0).includes('~2 hour(s) 30 minute(s)'),
	);
});

test('warns when a repo contributed no files', async t => {
	const markdown = renderEstimate(await estimateOf({}, []));
	t.true(markdown.includes('contributed no files'));
	t.true(markdown.includes('--clone'));
});

test('warns about missing packs, unparseable packs, and target errors', t => {
	const markdown = renderEstimate({
		repos: [
			{
				repo: 'my-org/a',
				packs: ['p'],
				files: 3,
				requests: 1,
				tokens: 100,
				durationMs: 1000,
				missingPacks: ['gone'],
			},
		],
		totals: {
			repos: 1,
			rulePacks: 1,
			files: 3,
			requests: 1,
			tokens: 100,
			durationMs: 1000,
		},
		calibration: {
			msPerRequest: 1000,
			requestsPerPass: 1,
			outputTokensPerRequest: 100,
			samples: 1,
		},
		packLoadErrors: [{file: 'broken.md', errors: []}],
		targetErrors: ['failed to list repos for "my-org"'],
	});
	t.true(markdown.includes('rule pack(s) not in rule-packs/ — gone'));
	t.true(markdown.includes('`broken.md` failed to parse'));
	t.true(markdown.includes('failed to list repos'));
});

test('says so when no repositories resolved', async t => {
	const estimate = await estimateOf({targets: []});
	t.is(estimate.totals.repos, 0);
	const markdown = renderEstimate(estimate);
	t.true(markdown.includes('No repositories resolved'));
	t.false(markdown.includes('| Repository |'));
});
