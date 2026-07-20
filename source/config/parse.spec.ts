import test from 'ava';
import {parseConfig} from './parse.js';

console.log('\nconfig/parse.spec.ts');

const FULL_CONFIG = `
targets:
  - repo: my-org/my-program
    rule_packs: [solana-anchor, rust-general]
  - pattern: "my-org/web-*"
    rule_packs: [web-frontend]

schedule: "0 6 * * *"
severity_threshold: high

model:
  provider: ollama
  model: llama3.1:70b
  fallback:
    provider: openai
    model: gpt-x
    endpoint_secret: SENTINEL_MODEL_KEY

issues:
  label: audit
  assignee: octocat
  aggregate_to_config_repo: true
`;

test('parses and normalises a full config', t => {
	const result = parseConfig(FULL_CONFIG);
	t.true(result.valid);
	t.deepEqual(result.errors, []);
	const config = result.config;
	t.is(config?.targets.length, 2);
	t.is(config?.targets[0]?.repo, 'my-org/my-program');
	t.deepEqual(config?.targets[0]?.rulePacks, ['solana-anchor', 'rust-general']);
	t.is(config?.targets[1]?.pattern, 'my-org/web-*');
	t.is(config?.schedule, '0 6 * * *');
	t.is(config?.severityThreshold, 'high');
	t.is(config?.model.provider, 'ollama');
	t.is(config?.model.fallback?.endpointSecret, 'SENTINEL_MODEL_KEY');
	t.is(config?.issues.label, 'audit');
	t.is(config?.issues.assignee, 'octocat');
	t.true(config?.issues.aggregateToConfigRepo);
});

test('applies defaults for optional fields', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: [pack]
model:
  provider: ollama
  model: llama3.1
`);
	t.true(result.valid);
	t.is(result.config?.schedule, '0 6 * * *');
	t.is(result.config?.severityThreshold, 'medium');
	t.is(result.config?.issues.label, 'sentinel');
	t.is(result.config?.issues.assignee, null);
	t.false(result.config?.issues.aggregateToConfigRepo);
});

test('rejects invalid YAML', t => {
	const result = parseConfig('targets: [unterminated');
	t.false(result.valid);
	t.is(result.errors[0]?.field, 'document');
});

test('requires at least one target', t => {
	const result = parseConfig(
		'model:\n  provider: o\n  model: m\ntargets: []\n',
	);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'targets'));
});

test('requires a model', t => {
	const result = parseConfig('targets:\n  - repo: a/b\n    rule_packs: [p]\n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'model'));
});

test('rejects a target with both repo and pattern', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    pattern: "a/*"
    rule_packs: [p]
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'targets[0]'));
});

test('rejects a malformed repo slug', t => {
	const result = parseConfig(`
targets:
  - repo: not-a-slug
    rule_packs: [p]
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'targets[0].repo'));
});

test('rejects empty rule_packs', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: []
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'targets[0].rule_packs'));
});

test('rejects a non-kebab-case pack name', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: [Not_Kebab]
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'targets[0].rule_packs[0]'));
});

test('rejects an out-of-scale severity threshold', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: [p]
severity_threshold: blocker
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'severity_threshold'));
});

test('rejects a non-cron schedule', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: [p]
schedule: "every day"
model:
  provider: o
  model: m
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'schedule'));
});

test('rejects a fallback missing its model', t => {
	const result = parseConfig(`
targets:
  - repo: a/b
    rule_packs: [p]
model:
  provider: ollama
  model: llama3.1
  fallback:
    provider: openai
`);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'model.fallback'));
});
