import test from 'ava';
import type {RepoOverride, SentinelConfig} from '../config/types.js';
import type {Finding} from '../findings/types.js';
import {applyRepoOverride, isSuppressed, matchesSuppression} from './apply.js';

console.log('\nsuppression/apply.spec.ts');

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'solana-anchor/pda-derivation',
		file: 'programs/vault/src/lib.rs',
		lineRange: {start: 1, end: 2},
		category: 'security',
		severity: 'medium',
		confidence: 'medium',
		offendingSnippet: 'x',
		...overrides,
	};
}

function config(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
	return {
		targets: [{repo: 'my-org/x', rulePacks: ['p']}],
		schedule: '0 6 * * *',
		severityThreshold: 'medium',
		model: {provider: 'ollama', model: 'llama3.1'},
		issues: {label: 'sentinel', assignee: null, aggregateToConfigRepo: false},
		...overrides,
	};
}

test('matches on an exact rule', t => {
	t.true(
		matchesSuppression(finding(), {
			rule: 'solana-anchor/pda-derivation',
			paths: [],
			reason: 'exempt',
		}),
	);
});

test('matches a rule glob', t => {
	t.true(
		matchesSuppression(finding(), {
			rule: 'solana-anchor/*',
			paths: [],
			reason: '',
		}),
	);
	t.false(
		matchesSuppression(finding(), {
			rule: 'rust-general/*',
			paths: [],
			reason: '',
		}),
	);
});

test('matches on a path glob', t => {
	t.true(
		matchesSuppression(finding(), {paths: ['programs/vault/**'], reason: ''}),
	);
	t.false(matchesSuppression(finding(), {paths: ['app/**'], reason: ''}));
});

test('rule and paths together are an AND', t => {
	const s = {
		rule: 'solana-anchor/*',
		paths: ['programs/vault/**'],
		reason: '',
	};
	t.true(matchesSuppression(finding(), s));
	// Right rule, wrong path.
	t.false(matchesSuppression(finding({file: 'app/index.ts'}), s));
	// Right path, wrong rule.
	t.false(matchesSuppression(finding({rule: 'rust-general/unwrap'}), s));
});

test('a suppression with neither clause never matches', t => {
	t.false(matchesSuppression(finding(), {paths: [], reason: 'empty'}));
});

test('isSuppressed is true when any suppression matches', t => {
	const override: RepoOverride = {
		suppress: [
			{rule: 'other/*', paths: [], reason: ''},
			{paths: ['programs/vault/**'], reason: 'vault exempt'},
		],
	};
	t.true(isSuppressed(finding(), override));
});

test('applyRepoOverride keeps everything with no override', t => {
	const findings = [finding(), finding({file: 'a.rs'})];
	const outcome = applyRepoOverride(findings, config());
	t.is(outcome.kept.length, 2);
	t.is(outcome.suppressed.length, 0);
	t.is(outcome.threshold, 'medium');
});

test('applyRepoOverride partitions suppressed findings', t => {
	const override: RepoOverride = {
		suppress: [{paths: ['programs/vault/**'], reason: 'exempt'}],
	};
	const findings = [finding(), finding({file: 'app/index.ts'})];
	const outcome = applyRepoOverride(findings, config(), override);
	t.is(outcome.kept.length, 1);
	t.is(outcome.kept[0]?.file, 'app/index.ts');
	t.is(outcome.suppressed.length, 1);
});

test('applyRepoOverride uses the override threshold when present', t => {
	const override: RepoOverride = {severityThreshold: 'high', suppress: []};
	const outcome = applyRepoOverride([finding()], config(), override);
	t.is(outcome.threshold, 'high');
});
