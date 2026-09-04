import test from 'ava';
import type {SentinelConfig} from '../config/types.js';
import type {RunRecord, RunUsage} from '../observe/types.js';
import type {SourceFile} from '../prompt/types.js';
import {matchesGlob} from '../rule-packs/glob.js';
import type {RulePack} from '../rule-packs/types.js';
import type {PrepareResult} from './clone.js';
import {
	type AuditEstimate,
	type Calibration,
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

/**
 * Stands in for a checked-out repository. It must apply the patterns it is
 * given exactly as fsRepoFiles does — a stub that returns everything models a
 * read production never performs, and cannot tell an absent checkout from a
 * present one that nothing matched.
 */
function repoFiles(files: SourceFile[]): RepoFiles {
	return {
		async read(_repoDir: string, patterns: string[]): Promise<SourceFile[]> {
			// An empty pattern list means the whole repository.
			if (patterns.length === 0) {
				return files;
			}
			return files.filter(file =>
				patterns.some(pattern => matchesGlob(pattern, file.path)),
			);
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

/** What one request costs at a given prompt size under a calibration. */
function msAt(calibration: Calibration, promptTokens: number): number {
	return calibration.msPerRequest + calibration.msPerPromptToken * promptTokens;
}

test('calibrate derives per-request figures from recorded usage', t => {
	const calibration = calibrate([
		record(
			{requests: 4, durationMs: 40_000, promptTokens: 8000, outputTokens: 800},
			4,
		),
	]);
	t.is(calibration.samples, 1);
	t.is(calibration.outputTokensPerRequest, 200);
	t.is(calibration.requestsPerPass, 1);
	// One record cannot separate fixed from per-token cost, so the split is
	// assumed — but it must still reproduce the 10s/request actually measured
	// at the 2,000 prompt tokens/request that record carried.
	t.is(msAt(calibration, 2000), 10_000);
	t.true(calibration.msPerRequest > 0);
	t.true(calibration.msPerPromptToken > 0);
});

test('calibrate separates fixed from per-token cost across differing sizes', t => {
	// 20s of fixed cost plus 10ms per prompt token, measured at two sizes.
	const small = record(
		{requests: 1, durationMs: 30_000, promptTokens: 1000, outputTokens: 100},
		1,
	);
	small.timestamp = '2026-07-20T06:00:00.000Z';
	const large = record(
		{requests: 1, durationMs: 120_000, promptTokens: 10_000, outputTokens: 100},
		1,
	);
	const calibration = calibrate([large, small]);
	t.is(calibration.samples, 2);
	t.is(Math.round(calibration.msPerRequest), 20_000);
	t.is(Math.round(calibration.msPerPromptToken), 10);
	// And it reproduces both observations it was fitted from.
	t.is(Math.round(msAt(calibration, 1000)), 30_000);
	t.is(Math.round(msAt(calibration, 10_000)), 120_000);
});

test('calibrate falls back to a split when the fit would go negative', t => {
	// A bigger prompt that ran faster — noise, not a real negative rate.
	const fast = record(
		{requests: 1, durationMs: 5000, promptTokens: 10_000, outputTokens: 100},
		1,
	);
	fast.timestamp = '2026-07-20T06:00:00.000Z';
	const slow = record(
		{requests: 1, durationMs: 60_000, promptTokens: 1000, outputTokens: 100},
		1,
	);
	const calibration = calibrate([slow, fast]);
	t.true(calibration.msPerRequest >= 0);
	t.true(calibration.msPerPromptToken >= 0);
	// Pooled average preserved: 32.5s per request at 5,500 prompt tokens.
	t.is(Math.round(msAt(calibration, 5500)), 32_500);
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
	t.is(calibration.outputTokensPerRequest, 200);
	// Both records are the same prompt size, so the terms cannot be separated
	// and the pooled 20s/request average is split instead.
	t.is(msAt(calibration, 100), 20_000);
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
	t.is(msAt(calibration, 100), 2000);
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

test('runtime scales with prompt size, not just request count', async t => {
	// Calibrated on a small config, then asked to size a much larger one. The
	// request count is identical, so a flat per-request average would report the
	// same runtime for both — the failure this term exists to prevent.
	const records = [
		record(
			{requests: 1, durationMs: 30_000, promptTokens: 1000, outputTokens: 100},
			1,
		),
	];
	const line = 'const x: number = 1;\n';
	const small = await estimateRun(
		config(),
		{
			files: repoFiles([{path: 'src/a.ts', content: line}]),
			packs: packLoader({packs: [pack('p')], errors: []}),
			records,
		},
		OPTIONS,
	);
	const large = await estimateRun(
		config(),
		{
			files: repoFiles([{path: 'src/a.ts', content: line.repeat(5000)}]),
			packs: packLoader({packs: [pack('p')], errors: []}),
			records,
		},
		OPTIONS,
	);

	t.is(small.totals.requests, large.totals.requests);
	t.true(large.totals.tokens > small.totals.tokens * 10);
	t.true(large.totals.durationMs > small.totals.durationMs * 5);
});

test('an uncalibrated estimate still scales with prompt size', async t => {
	// The built-in defaults carry the per-token term too, so the first estimate
	// an install ever runs is not prompt-size-blind either.
	const line = 'const x: number = 1;\n';
	const small = await estimateOf({}, [{path: 'src/a.ts', content: line}]);
	const large = await estimateOf({}, [
		{path: 'src/a.ts', content: line.repeat(5000)},
	]);
	t.is(small.calibration.samples, 0);
	t.true(large.totals.durationMs > small.totals.durationMs * 5);
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
	t.not(calibrated.totals.durationMs, uncalibrated.totals.durationMs);
	t.true(calibrated.totals.durationMs > 0);
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
				msPerPromptToken: 0,
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
	// Handover at 60s, not 90s: rounding minutes from 89s gave "1 minute(s)"
	// no window at all, so the output jumped 89 second(s) -> 2 minute(s).
	t.true(of(59_000, 0).includes('~59 second(s)'));
	t.true(of(60_000, 0).includes('~1 minute(s)'));
	t.true(of(89_000, 0).includes('~1 minute(s)'));
	t.true(of(3 * 3_600_000, 0).includes('~3 hour(s)'));
	t.true(
		of(2 * 3_600_000 + 30 * 60_000, 0).includes('~2 hour(s) 30 minute(s)'),
	);
});

test('warns when a repo is not checked out', async t => {
	const markdown = renderEstimate(await estimateOf({}, []));
	t.true(markdown.includes('are not checked out'));
	t.true(markdown.includes('--clone'));
});

test('a checked-out repo that matches no file is not told to clone', async t => {
	// Present on disk, but the pack scopes to src/**/*.ts and none of it is.
	const estimate = await estimateOf({}, [
		{path: 'README.md', content: '# nothing to audit'},
	]);
	t.is(estimate.repos[0]?.files, 0);
	t.true(estimate.repos[0]?.checkedOut);

	const markdown = renderEstimate(estimate);
	t.true(markdown.includes('no file matched'));
	t.false(markdown.includes('--clone'));
});

test('warns about missing packs, unparseable packs, and target errors', t => {
	const markdown = renderEstimate({
		repos: [
			{
				repo: 'my-org/a',
				packs: ['p'],
				files: 3,
				checkedOut: true,
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

test('calibrate survives a record with no prompt tokens', async t => {
	// A legacy or truncated record: requests and duration, but no token counts.
	// The per-token term has nothing to divide by, so all of the measured cost
	// stays fixed rather than becoming NaN and poisoning every figure.
	const calibration = calibrate([
		record(
			{requests: 2, durationMs: 8000, promptTokens: 0, outputTokens: 0},
			2,
		),
	]);
	t.is(calibration.msPerRequest, 4000);
	t.is(calibration.msPerPromptToken, 0);

	const estimate = await estimateRun(
		config(),
		{
			files: repoFiles(FILES),
			packs: packLoader({packs: [pack('p')], errors: []}),
			records: [
				record(
					{requests: 2, durationMs: 8000, promptTokens: 0, outputTokens: 0},
					2,
				),
			],
		},
		OPTIONS,
	);
	t.true(Number.isFinite(estimate.totals.durationMs));
	t.true(estimate.totals.durationMs > 0);
});

// The case from review: one pack scoped to a language the repo does not
// contain. Both the scoped read and the audited set come back empty, so the
// only thing that separates this from an un-cloned repo is a read that ignores
// the patterns. Getting it wrong sends the operator to clone what they have.
test('a single pack matching nothing is not mistaken for a missing checkout', async t => {
	const python = pack('py');
	python.manifest.appliesTo = {paths: ['**/*.py'], languages: ['python']};

	const estimate = await estimateRun(
		config({targets: [{repo: 'my-org/a', rulePacks: ['py']}]}),
		{
			files: repoFiles(FILES), // a TypeScript repo, checked out
			packs: packLoader({packs: [python], errors: []}),
		},
		OPTIONS,
	);

	t.is(estimate.repos[0]?.files, 0);
	t.true(estimate.repos[0]?.checkedOut);

	const markdown = renderEstimate(estimate);
	t.true(markdown.includes('no file matched'));
	t.false(markdown.includes('--clone'));
});

test('an absent checkout is still told to clone', async t => {
	// Same shape, but nothing on disk at all: the unscoped read is empty too.
	const python = pack('py');
	python.manifest.appliesTo = {paths: ['**/*.py'], languages: ['python']};

	const estimate = await estimateRun(
		config({targets: [{repo: 'my-org/a', rulePacks: ['py']}]}),
		{
			files: repoFiles([]),
			packs: packLoader({packs: [python], errors: []}),
		},
		OPTIONS,
	);

	t.false(estimate.repos[0]?.checkedOut);
	const markdown = renderEstimate(estimate);
	t.true(markdown.includes('are not checked out'));
	t.true(markdown.includes('--clone'));
});

test('the unscoped read is skipped when the scoped one found files', async t => {
	// The extra read exists only to disambiguate an empty result, so it must not
	// cost anything on the common path.
	const reads: string[][] = [];
	const counting: RepoFiles = {
		async read(_repoDir: string, patterns: string[]): Promise<SourceFile[]> {
			reads.push(patterns);
			return patterns.length === 0
				? FILES
				: FILES.filter(file =>
						patterns.some(pattern => matchesGlob(pattern, file.path)),
					);
		},
		async readText(): Promise<string | null> {
			return null;
		},
	};

	const estimate = await estimateRun(
		config(),
		{files: counting, packs: packLoader({packs: [pack('p')], errors: []})},
		OPTIONS,
	);

	t.true(estimate.repos[0]?.checkedOut);
	t.is(reads.length, 1);
	t.deepEqual(reads[0], ['src/**/*.ts']);
});
