import test from 'ava';
import type {ModelConfig} from '../config/types.js';
import type {ModelRunner, ModelRunResult} from '../orchestrator/types.js';
import type {RulePack} from '../rule-packs/types.js';
import {auditPack} from './audit.js';

console.log('\nrun/audit.spec.ts');

const MODEL: ModelConfig = {provider: 'ollama', model: 'llama3.1'};

const PACK: RulePack = {
	manifest: {
		name: 'p',
		version: '2.0.0',
		description: '',
		appliesTo: {paths: ['src/**/*.ts'], languages: ['typescript']},
		severityWeighting: {},
		dependsOn: [],
		category: 'security',
	},
	body: 'Flag bugs.',
};

const FINDING = {
	rule: 'p/r',
	file: 'src/a.ts',
	line_range: {start: 1, end: 2},
	category: 'security',
	severity: 'high',
	confidence: 'medium',
	offending_snippet: 'x',
};

function runner(result: ModelRunResult): ModelRunner & {prompt?: string} {
	return {
		async run(prompt): Promise<ModelRunResult> {
			this.prompt = prompt;
			return result;
		},
	};
}

test('produces a PackOutcome with findings from the model', async t => {
	const r = runner({ok: true, output: JSON.stringify([FINDING])});
	const outcome = await auditPack(
		PACK,
		{repoName: 'org/a', files: [{path: 'src/a.ts', content: 'const x = 1;'}]},
		MODEL,
		r,
	);
	t.is(outcome.pack, 'p');
	t.is(outcome.version, '2.0.0');
	t.true(outcome.ok);
	t.is(outcome.findings.length, 1);
	t.is(outcome.attempts, 1);
	// The prompt was built from the pack body and the files.
	t.true(r.prompt?.includes('Flag bugs.'));
	t.true(r.prompt?.includes('src/a.ts'));
});

test('surfaces a run error in the outcome', async t => {
	const outcome = await auditPack(
		PACK,
		{repoName: 'org/a', files: []},
		MODEL,
		runner({ok: false, output: '', error: 'nanocoder missing'}),
	);
	t.false(outcome.ok);
	t.is(outcome.runError, 'nanocoder missing');
	t.is(outcome.findings.length, 0);
});
