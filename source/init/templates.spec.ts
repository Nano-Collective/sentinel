import test from 'ava';
import {parseConfig} from '../config/parse.js';
import {parseRulePack} from '../rule-packs/parse.js';
import {
	configReadme,
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

test('the readme points at the authoring docs and the schedule', t => {
	const readme = configReadme(options({schedule: '0 6 * * *'}));
	t.true(readme.includes('rule-packs/authoring'));
	t.true(readme.includes('0 6 * * *'));
	t.true(readme.includes('ships **no rule packs**'));
});
