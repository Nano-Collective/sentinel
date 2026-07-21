import test from 'ava';
import type {Finding} from '../findings/types.js';
import {buildIssueBody, buildIssueTitle} from './body.js';
import type {FilingContext} from './types.js';

console.log('\nissues/body.spec.ts');

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'solana-anchor/missing-signer-check',
		file: 'programs/vault/src/lib.rs',
		lineRange: {start: 42, end: 48},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'pub fn withdraw(ctx: Context<Withdraw>) {',
		summary: 'Missing signer check on withdraw',
		rationale: 'withdraw moves funds but never asserts the authority signed.',
		suggestedNextSteps: 'Add a Signer constraint on the authority account.',
		...overrides,
	};
}

const CTX: FilingContext = {
	auditedRepo: 'my-org/my-program',
	configRepo: 'my-org/sentinel-config',
	packVersion: '1.2.0',
};

test('title is concise and carries severity, headline, and location', t => {
	const title = buildIssueTitle(finding());
	t.is(
		title,
		'Sentinel [high] Missing signer check on withdraw (programs/vault/src/lib.rs:42)',
	);
});

test('title falls back to the rule when there is no summary', t => {
	const title = buildIssueTitle(finding({summary: undefined}));
	t.true(title.includes('solana-anchor/missing-signer-check'));
});

test('title truncates an overlong headline', t => {
	const title = buildIssueTitle(finding({summary: 'x'.repeat(200)}));
	t.true(title.includes('…'));
	t.true(title.length < 140);
});

test('body renders every section when all fields are present', t => {
	const body = buildIssueBody(finding(), CTX);
	t.true(body.includes('Missing signer check on withdraw'));
	t.true(body.includes('**Severity:** high'));
	t.true(body.includes('lines 42–48'));
	t.true(body.includes('(pack 1.2.0)'));
	t.true(body.includes('### Why this severity'));
	t.true(body.includes('### Offending code'));
	t.true(body.includes('### Suggested next steps'));
	t.true(body.includes('sentinel:false-positive'));
	t.true(body.includes('my-org/sentinel-config'));
});

test('body degrades gracefully without the optional fields', t => {
	const body = buildIssueBody(
		finding({
			summary: undefined,
			rationale: undefined,
			suggestedNextSteps: undefined,
		}),
		{auditedRepo: 'my-org/my-program'},
	);
	t.true(body.includes('A security finding produced by rule'));
	t.false(body.includes('### Why this severity'));
	t.false(body.includes('### Suggested next steps'));
	// Offending code is always shown.
	t.true(body.includes('### Offending code'));
	// No config repo → no config link.
	t.false(body.includes('Configured in'));
});

test('body uses a fence that survives backticks in the snippet', t => {
	const snippet = 'doc = "```rust\\nlet x = 1;\\n```"';
	const body = buildIssueBody(finding({offendingSnippet: snippet}), CTX);
	// A snippet containing a ``` run must be wrapped in a longer (````) fence.
	t.true(body.includes('````'));
	t.true(body.includes(snippet));
});
