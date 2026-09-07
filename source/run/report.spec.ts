import test from 'ava';
import type {ReconcileResult} from '../dedup/reconcile.js';
import type {Finding} from '../findings/types.js';
import {
	countFindings,
	hasRunProblems,
	type RunProblems,
	renderFilingLine,
	renderReport,
	renderRunProblems,
} from './report.js';
import type {PackOutcome, RunOutcome} from './types.js';

console.log('\nrun/report.spec.ts');

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'p/r',
		file: 'a.rs',
		lineRange: {start: 1, end: 3},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'x',
		summary: 'A bug',
		rationale: 'because',
		suggestedNextSteps: 'fix it',
		...overrides,
	};
}

function pack(overrides: Partial<PackOutcome> = {}): PackOutcome {
	return {
		pack: 'p',
		version: '1.0.0',
		findings: [finding()],
		attempts: 1,
		ok: true,
		errors: [],
		usage: {durationMs: 0, promptTokens: 0, outputTokens: 0},
		...overrides,
	};
}

function result(overrides: Partial<ReconcileResult> = {}): ReconcileResult {
	return {
		targetRepo: 'org/a',
		created: [],
		touched: 0,
		incremented: 0,
		resolved: 0,
		suppressed: 0,
		suppressedByOverride: 0,
		errors: [],
		...overrides,
	};
}

test('renders every filing counter in the per-repo line', t => {
	t.is(
		renderFilingLine(
			'myorg/myrepo',
			result({
				created: [
					{number: 1, url: 'u'},
					{number: 2, url: 'v'},
					{number: 3, url: 'w'},
				],
				touched: 5,
				incremented: 2,
				suppressed: 1,
			}),
		),
		'myorg/myrepo: filed 3, touched 5, aged 2, suppressed 1, suppressed-by-override 0, resolved 0',
	);
});

test('prints zeroed counters rather than omitting them', t => {
	t.is(
		renderFilingLine('org/a', result()),
		'org/a: filed 0, touched 0, aged 0, suppressed 0, suppressed-by-override 0, resolved 0',
	);
});

test('names the audited repo, not the issue target', t => {
	const line = renderFilingLine(
		'org/audited',
		result({targetRepo: 'org/central'}),
	);
	t.true(line.startsWith('org/audited: '));
	t.false(line.includes('org/central'));
});

test('the filing line omits tolerated errors', t => {
	const line = renderFilingLine('org/a', result({errors: ['create: boom']}));
	t.false(line.includes('boom'));
});

test('renders findings grouped by repo and pack', t => {
	const run: RunOutcome = {
		repos: [
			{repo: 'org/a', packs: [pack()], missingPacks: [], unresolvedPacks: []},
		],
	};
	const md = renderReport(run);
	t.true(md.includes('# Sentinel audit report'));
	t.true(md.includes('1 finding(s) across 1 repository'));
	t.true(md.includes('## org/a'));
	t.true(md.includes('### Pack `p` (v1.0.0)'));
	t.true(md.includes('HIGH — A bug'));
	t.true(md.includes('**Why:** because'));
	t.true(md.includes('**Next:** fix it'));
});

test('countFindings totals across repos and packs', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [pack({findings: [finding(), finding()]})],
				missingPacks: [],
				unresolvedPacks: [],
			},
			{
				repo: 'b',
				packs: [pack({findings: []})],
				missingPacks: [],
				unresolvedPacks: [],
			},
		],
	};
	t.is(countFindings(run), 2);
});

test('reports a clean pack as no findings', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [pack({findings: []})],
				missingPacks: [],
				unresolvedPacks: [],
			},
		],
	};
	t.true(renderReport(run).includes('No findings.'));
});

test('reports a run error', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [pack({ok: false, findings: [], runError: 'nanocoder missing'})],
				missingPacks: [],
				unresolvedPacks: [],
			},
		],
	};
	t.true(renderReport(run).includes('Run error: nanocoder missing'));
});

test('reports validation failure after retries', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [
					pack({
						ok: false,
						findings: [],
						attempts: 2,
						errors: [{index: 0, field: 'severity', message: 'bad'}],
					}),
				],
				missingPacks: [],
				unresolvedPacks: [],
			},
		],
	};
	t.true(renderReport(run).includes('malformed after 2 attempt'));
});

test('lists missing packs for a repo', t => {
	const run: RunOutcome = {
		repos: [
			{repo: 'a', packs: [], missingPacks: ['ghost'], unresolvedPacks: []},
		],
	};
	t.true(
		renderReport(run).includes('Missing packs (not in rule-packs/): ghost'),
	);
});

test('handles a run with no repositories', t => {
	t.true(renderReport({repos: []}).includes('No repositories were audited.'));
});

// --- the error-surfacing class ----------------------------------------------

const NO_PROBLEMS: RunProblems = {
	packLoadErrors: [],
	targetErrors: [],
	filingErrors: [],
};

test('a run with nothing wrong renders no problems section', t => {
	t.false(hasRunProblems(NO_PROBLEMS));
	t.is(renderRunProblems(NO_PROBLEMS), '');
});

test('filing errors recorded as an empty list are not a problem', t => {
	const problems: RunProblems = {
		...NO_PROBLEMS,
		filingErrors: [{repo: 'a', errors: []}],
	};
	t.false(hasRunProblems(problems));
	t.is(renderRunProblems(problems), '');
});

test('a rule pack that failed to load is surfaced with its reason', t => {
	// The bug: packLoadErrors was collected on the run report and read by
	// nothing, so a pack that failed to parse was silently absent from the audit.
	const problems: RunProblems = {
		...NO_PROBLEMS,
		packLoadErrors: [
			{
				file: 'broken.md',
				errors: [{field: 'name', message: 'missing'}],
			},
		],
	};
	t.true(hasRunProblems(problems));
	const markdown = renderRunProblems(problems);
	t.true(markdown.includes('Problems'));
	t.true(markdown.includes('broken.md'));
	t.true(markdown.includes('name: missing'));
	t.true(markdown.includes('incomplete'));
});

test('a pack load error with no detail still names the file', t => {
	const markdown = renderRunProblems({
		...NO_PROBLEMS,
		packLoadErrors: [{file: 'broken.md', errors: []}],
	});
	t.true(markdown.includes('broken.md'));
	t.true(markdown.includes('could not be parsed'));
});

test('targets that could not be audited are surfaced', t => {
	const markdown = renderRunProblems({
		...NO_PROBLEMS,
		targetErrors: ['could not check out my-org/a: no access'],
	});
	t.true(hasRunProblems({...NO_PROBLEMS, targetErrors: ['x']}));
	t.true(markdown.includes('could not be audited'));
	t.true(markdown.includes('no access'));
});

test('filing errors are surfaced per repo', t => {
	const markdown = renderRunProblems({
		...NO_PROBLEMS,
		filingErrors: [
			{repo: 'my-org/a', errors: ['ensure label "sentinel": gh failed']},
		],
	});
	t.true(markdown.includes('my-org/a'));
	t.true(markdown.includes('ensure label "sentinel"'));
});

test('every problem channel appears in one section', t => {
	const markdown = renderRunProblems({
		packLoadErrors: [{file: 'broken.md', errors: []}],
		targetErrors: ['no access'],
		filingErrors: [{repo: 'a', errors: ['label failed']}],
	});
	t.true(markdown.includes('broken.md'));
	t.true(markdown.includes('no access'));
	t.true(markdown.includes('label failed'));
	// One heading, not three.
	t.is(markdown.split('## ⚠️ Problems').length - 1, 1);
});

test('an unresolvable dependency chain is not reported as a missing pack', t => {
	// The bug: a pack that exists but whose depends_on graph is broken was
	// pushed onto missingPacks and rendered as "not in rule-packs/" — false, and
	// it sent the reader hunting for a file that is sitting right there.
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [],
				missingPacks: [],
				unresolvedPacks: [
					{
						pack: 'app',
						errors: [
							{field: 'depends_on', message: 'unknown rule pack: absent'},
						],
					},
				],
			},
		],
	};
	const markdown = renderReport(run);
	t.false(markdown.includes('not in rule-packs/'));
	t.true(markdown.includes('depends_on chain did not resolve'));
	t.true(markdown.includes('unknown rule pack: absent'));
	t.true(markdown.includes('`app`'));
});

test('missing and unresolved packs render as separate lines', t => {
	const run: RunOutcome = {
		repos: [
			{
				repo: 'a',
				packs: [],
				missingPacks: ['ghost'],
				unresolvedPacks: [
					{pack: 'app', errors: [{field: 'depends_on', message: 'cycle'}]},
				],
			},
		],
	};
	const markdown = renderReport(run);
	t.true(markdown.includes('Missing packs (not in rule-packs/): ghost'));
	t.true(markdown.includes('`app`'));
	t.false(markdown.includes('not in rule-packs/): ghost, app'));
});
