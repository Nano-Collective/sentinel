import test from 'ava';
import {parse} from 'yaml';
import {parseConfig} from '../config/parse.js';
import {parseRulePack} from '../rule-packs/parse.js';
import {
	configReadme,
	nanocoderConfig,
	sentinelYaml,
	starterPack,
	workflowYaml,
} from './templates.js';
import {DEFAULT_INIT_OPTIONS, type InitOptions} from './types.js';

console.log('\ninit/templates.spec.ts');

function options(overrides: Partial<InitOptions> = {}): InitOptions {
	return {...DEFAULT_INIT_OPTIONS, ...overrides};
}

test('generated sentinel.yaml parses under parseConfig', t => {
	const result = parseConfig(sentinelYaml(options()));
	t.true(result.valid);
	t.deepEqual(result.errors, []);
});

test('generated sentinel.yaml uses a placeholder target by default', t => {
	const result = parseConfig(sentinelYaml(options()));
	t.is(result.config?.targets[0]?.repo, 'your-org/your-repo');
});

test('generated sentinel.yaml carries the chosen options', t => {
	const result = parseConfig(
		sentinelYaml(
			options({
				targets: ['my-org/a', 'my-org/b'],
				provider: 'lmstudio',
				model: 'qwen2.5',
				schedule: '0 9 * * 1',
				severityThreshold: 'high',
				label: 'audit',
			}),
		),
	);
	t.true(result.valid);
	t.is(result.config?.targets.length, 2);
	t.is(result.config?.model.provider, 'lmstudio');
	t.is(result.config?.schedule, '0 9 * * 1');
	t.is(result.config?.severityThreshold, 'high');
	t.is(result.config?.issues.label, 'audit');
});

test('the starter pack parses under parseRulePack', t => {
	const result = parseRulePack(starterPack());
	t.true(result.valid);
	t.is(result.pack?.manifest.name, 'example');
	// Exercises every manifest field.
	t.truthy(result.pack?.manifest.description);
	t.deepEqual(result.pack?.manifest.appliesTo.paths, ['src/**/*.ts']);
	t.is(result.pack?.manifest.severityWeighting['sql-injection'], 'critical');
	t.is(result.pack?.manifest.category, 'security');
});

test('the workflow embeds the schedule and dispatch input', t => {
	const yaml = workflowYaml(options({schedule: '30 5 * * *'}));
	t.true(yaml.includes('cron: "30 5 * * *"'));
	t.true(yaml.includes('workflow_dispatch'));
	t.true(yaml.includes('issues: write'));
	t.true(yaml.includes('@nanocollective/sentinel'));
});

test('the workflow wires the token, workspace, and step summary', t => {
	const yaml = workflowYaml(options());
	t.true(yaml.includes('SENTINEL_TOKEN || secrets.GITHUB_TOKEN'));
	t.true(yaml.includes('--workspace "$RUNNER_TEMP/sentinel"'));
	t.true(yaml.includes('--output "$GITHUB_STEP_SUMMARY"'));
	t.true(yaml.includes('concurrency:'));
});

test('the dry-run input reaches the script through the environment', t => {
	// Not interpolated into `run:`. The input is a typed boolean so it cannot
	// carry anything but true or false, but a `${{ }}` inside a shell script is
	// the shape of an injection regardless — and this file is the one every
	// install copies.
	const {steps} = auditJob(options());
	const run = steps.find(step =>
		step.run?.includes('@nanocollective/sentinel'),
	);
	t.is(run?.env?.DRY_RUN, '${{ github.event.inputs.dry_run }}');
	t.false(
		(run?.run ?? '').includes('${{'),
		'the run script interpolates a workflow expression',
	);
	// Only the literal "true" may set the flag: an unticked checkbox arrives as
	// "false", and a scheduled run sends nothing at all. `${DRY_RUN:+...}` would
	// fire on both.
	t.true((run?.run ?? '').includes('"${DRY_RUN:-}" = "true"'));
});

test('the nanocoder config is valid JSON with a providers block', t => {
	const parsed = JSON.parse(nanocoderConfig(options()));
	t.true(Array.isArray(parsed.nanocoder.providers));
	t.is(parsed.nanocoder.providers[0]?.name, DEFAULT_INIT_OPTIONS.provider);
});

/**
 * The scaffolded workflow is the one artefact nothing else exercises — no test
 * ran it, and Sentinel does not audit itself, so "the generated workflow cannot
 * work" was invisible. These assert the parts a broken scaffold gets wrong,
 * structurally rather than by substring, because the failures they guard
 * against were all *absences*.
 */
function auditJob(options_: InitOptions): {
	runsOn: string;
	steps: {name?: string; run?: string; env?: Record<string, string>}[];
} {
	const parsed = parse(workflowYaml(options_)) as {
		jobs: {
			audit: {
				'runs-on': string;
				steps: {name?: string; run?: string; env?: Record<string, string>}[];
			};
		};
	};
	return {runsOn: parsed.jobs.audit['runs-on'], steps: parsed.jobs.audit.steps};
}

test('the generated workflow is valid YAML', t => {
	const job = auditJob(options());
	t.true(job.steps.length > 0);
});

test('the workflow installs Nanocoder before the step that invokes it', t => {
	// Sentinel spawns a bare `nanocoder`; it is not a dependency and npx does
	// not bring it. Without this step the run dies on its first model call.
	const {steps} = auditJob(options());
	const install = steps.findIndex(step =>
		step.run?.includes('@nanocollective/nanocoder'),
	);
	const run = steps.findIndex(step =>
		step.run?.includes('@nanocollective/sentinel'),
	);
	t.true(install !== -1, 'no step installs Nanocoder');
	t.true(run !== -1, 'no step runs Sentinel');
	t.true(install < run, 'Nanocoder is installed after it is needed');
});

test('a local provider scaffolds a runner that can reach it', t => {
	// ubuntu-latest has no ollama daemon, so a hosted runner here is a workflow
	// that cannot run.
	t.is(auditJob(options({provider: 'ollama'})).runsOn, 'self-hosted');
	t.is(auditJob(options({provider: 'lmstudio'})).runsOn, 'self-hosted');
	t.is(auditJob(options({provider: 'openai'})).runsOn, 'ubuntu-latest');
});

test('a cloud provider gets its endpoint key wired into the workflow', t => {
	const {steps} = auditJob(
		options({provider: 'openai', endpointSecret: 'MY_MODEL_KEY'}),
	);
	const run = steps.find(step =>
		step.run?.includes('@nanocollective/sentinel'),
	);
	t.is(run?.env?.MY_MODEL_KEY, '${{ secrets.MY_MODEL_KEY }}');
});

test('the workflow env and agents.config.json name the same secret', t => {
	// Two files have to agree on one name for the key to reach the model at
	// all, and post-scoping the placeholder is what allowlists it. Generated
	// from one option so they cannot drift.
	const chosen = options({provider: 'openai', endpointSecret: 'ACME_KEY'});
	const {steps} = auditJob(chosen);
	const run = steps.find(step =>
		step.run?.includes('@nanocollective/sentinel'),
	);
	const config = JSON.parse(nanocoderConfig(chosen));
	t.is(run?.env?.ACME_KEY, '${{ secrets.ACME_KEY }}');
	t.is(config.nanocoder.providers[0]?.apiKey, '${ACME_KEY}');
});

test('a local provider is not asked for a secret it does not need', t => {
	const {steps} = auditJob(options({provider: 'ollama'}));
	const run = steps.find(step =>
		step.run?.includes('@nanocollective/sentinel'),
	);
	t.is(run?.env?.SENTINEL_MODEL_KEY, undefined);
});

test('the audit agent cannot write, execute, or reach the network', t => {
	const disabled = new Set<string>(
		JSON.parse(nanocoderConfig(options())).nanocoder.disabledTools,
	);
	for (const tool of [
		'execute_bash',
		'fetch_url',
		'web_search',
		'agent',
		'file_op',
		'write_file',
		'string_replace',
		'diff_edit',
		'git_commit',
		'ask_user',
	]) {
		t.true(disabled.has(tool), `${tool} is not disabled`);
	}
	// Reading is the job; it must survive.
	t.false(disabled.has('read_file'));
	t.false(disabled.has('search_file_contents'));
});

test('the readme points at the authoring docs and the schedule', t => {
	const readme = configReadme(options({schedule: '0 6 * * *'}));
	t.true(readme.includes('rule-packs/authoring'));
	t.true(readme.includes('0 6 * * *'));
	t.true(readme.includes('ships **no rule packs**'));
});

test('agents.config.json defines the provider sentinel.yaml names', t => {
	// NANOCODER_CONFIG_DIR replaces Nanocoder's provider list rather than adding
	// to it, so a local provider is not auto-detected once Sentinel points at a
	// config repo. Scaffolding `provider: ollama` beside a config that only
	// listed an example cloud provider produced
	// "Provider 'ollama' not found in agents.config.json" on every run.
	for (const provider of ['ollama', 'lmstudio', 'openai']) {
		const chosen = options({provider, model: 'some-model'});
		const named = parseConfig(sentinelYaml(chosen)).config?.model.provider;
		const entries = JSON.parse(nanocoderConfig(chosen)).nanocoder.providers as {
			name: string;
			models: string[];
		}[];
		t.is(entries.length, 1);
		t.is(entries[0]?.name, named ?? '', `${provider} is not configured`);
		t.deepEqual(entries[0]?.models, ['some-model']);
	}
});

test('a local provider is scaffolded with its endpoint and no key', t => {
	const entry = JSON.parse(nanocoderConfig(options({provider: 'ollama'})))
		.nanocoder.providers[0];
	t.is(entry.baseUrl, 'http://localhost:11434/v1');
	t.is(entry.apiKey, undefined);
});

test('a cloud provider is scaffolded with the endpoint secret placeholder', t => {
	const entry = JSON.parse(
		nanocoderConfig(options({provider: 'openai', endpointSecret: 'ACME_KEY'})),
	).nanocoder.providers[0];
	t.is(entry.apiKey, '${ACME_KEY}');
});
