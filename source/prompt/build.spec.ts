import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import {buildAuditPrompt} from './build.js';

console.log('\nprompt/build.spec.ts');

function pack(overrides: Partial<RulePack['manifest']> = {}): RulePack {
	return {
		manifest: {
			name: 'solana-anchor',
			version: '1.2.0',
			description: '',
			appliesTo: {paths: ['programs/**/*.rs'], languages: ['rust']},
			severityWeighting: {'missing-signer-check': 'critical'},
			dependsOn: [],
			category: 'security',
			...overrides,
		},
		body: '# Audit\n\nFlag missing signer checks.',
	};
}

test('includes the pack body as the audit instructions', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack(),
		files: [{path: 'programs/vault/lib.rs', content: 'fn main() {}'}],
	});
	t.true(prompt.includes('## Audit instructions'));
	t.true(prompt.includes('Flag missing signer checks.'));
});

test('scopes files by the pack applies_to and reports both sets', t => {
	const result = buildAuditPrompt({
		pack: pack(),
		files: [
			{path: 'programs/vault/lib.rs', content: 'a'},
			{path: 'app/index.ts', content: 'b'},
		],
	});
	t.deepEqual(result.includedFiles, ['programs/vault/lib.rs']);
	t.deepEqual(result.skippedFiles, ['app/index.ts']);
	t.true(result.prompt.includes('programs/vault/lib.rs'));
	t.false(result.prompt.includes('app/index.ts'));
});

test('an empty applies_to scope applies to every file', t => {
	const result = buildAuditPrompt({
		pack: pack({appliesTo: {paths: [], languages: []}}),
		files: [{path: 'anything.py', content: 'x'}],
	});
	t.deepEqual(result.includedFiles, ['anything.py']);
});

test('numbers file lines for line_range accuracy', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack({appliesTo: {paths: [], languages: []}}),
		files: [{path: 'a.rs', content: 'line one\nline two'}],
	});
	t.true(prompt.includes('1| line one'));
	t.true(prompt.includes('2| line two'));
});

test('states the snake_case reporting contract with the allowed scales', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack(),
		files: [{path: 'programs/x.rs', content: 'x'}],
	});
	t.true(prompt.includes('"line_range"'));
	t.true(prompt.includes('"offending_snippet"'));
	t.true(prompt.includes('"low", "medium", "high", "critical"'));
	t.true(prompt.includes('"low", "medium", "high"'));
	t.true(prompt.includes('Return [] if you find nothing.'));
});

test('renders severity weighting when present', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack(),
		files: [{path: 'programs/x.rs', content: 'x'}],
	});
	t.true(prompt.includes('## Severity weighting'));
	t.true(prompt.includes('missing-signer-check: critical'));
});

test('omits severity weighting when empty', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack({severityWeighting: {}}),
		files: [{path: 'programs/x.rs', content: 'x'}],
	});
	t.false(prompt.includes('## Severity weighting'));
});

test('includes repo name, notes, and context files', t => {
	const {prompt} = buildAuditPrompt({
		pack: pack(),
		files: [{path: 'programs/x.rs', content: 'x'}],
		repoName: 'my-org/my-program',
		repoNotes: 'This program handles user funds.',
		context: [{path: 'Anchor.toml', content: '[programs]'}],
	});
	t.true(prompt.includes('`my-org/my-program`'));
	t.true(prompt.includes('## Additional context'));
	t.true(prompt.includes('This program handles user funds.'));
	t.true(prompt.includes('Anchor.toml'));
});

test('notes when no files match the scope', t => {
	const result = buildAuditPrompt({
		pack: pack(),
		files: [{path: 'app/index.ts', content: 'x'}],
	});
	t.deepEqual(result.includedFiles, []);
	t.true(
		result.prompt.includes("No files matched this pack's applies_to scope"),
	);
});
