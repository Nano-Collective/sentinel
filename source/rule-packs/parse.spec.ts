import test from 'ava';
import {parseRulePack, splitFrontmatter} from './parse.js';

console.log('\nrule-packs/parse.spec.ts');

const VALID_PACK = `---
name: solana-anchor
version: 1.2.0
description: "Signer checks and PDA derivation for Anchor programs"
applies_to:
  paths: ["programs/**/*.rs"]
  languages: ["rust"]
severity_weighting:
  missing-signer-check: critical
  pda-derivation: medium
depends_on: ["rust-general"]
category: security
---

# What this pack audits

Flag missing signer checks on fund-moving instructions.
`;

test('splitFrontmatter separates the manifest from the body', t => {
	const split = splitFrontmatter(VALID_PACK);
	t.truthy(split);
	t.true(split?.yaml.includes('name: solana-anchor'));
	t.true(split?.body.startsWith('# What this pack audits'));
});

test('splitFrontmatter returns null without a fenced manifest', t => {
	t.is(splitFrontmatter('# Just a markdown file\n'), null);
});

test('splitFrontmatter handles CRLF line endings', t => {
	const crlf = VALID_PACK.replace(/\n/g, '\r\n');
	const split = splitFrontmatter(crlf);
	t.truthy(split);
	t.true(split?.yaml.includes('name: solana-anchor'));
});

test('parses and normalises a valid pack', t => {
	const result = parseRulePack(VALID_PACK);
	t.true(result.valid);
	t.deepEqual(result.errors, []);
	const {manifest, body} = result.pack ?? {manifest: null, body: ''};
	t.is(manifest?.name, 'solana-anchor');
	t.is(manifest?.version, '1.2.0');
	t.is(manifest?.category, 'security');
	t.deepEqual(manifest?.appliesTo.paths, ['programs/**/*.rs']);
	t.deepEqual(manifest?.appliesTo.languages, ['rust']);
	t.is(manifest?.severityWeighting['missing-signer-check'], 'critical');
	t.deepEqual(manifest?.dependsOn, ['rust-general']);
	t.true(body.includes('missing signer checks'));
});

test('defaults optional fields when omitted', t => {
	const pack = `---
name: minimal
version: 0.1.0
---
Audit everything.
`;
	const result = parseRulePack(pack);
	t.true(result.valid);
	t.is(result.pack?.manifest.description, '');
	t.is(result.pack?.manifest.category, '');
	t.deepEqual(result.pack?.manifest.appliesTo.paths, []);
	t.deepEqual(result.pack?.manifest.dependsOn, []);
});

test('rejects a file with no frontmatter', t => {
	const result = parseRulePack('# no manifest here');
	t.false(result.valid);
	t.is(result.errors[0]?.field, 'document');
});

test('rejects invalid YAML in the manifest', t => {
	const result = parseRulePack('---\nname: [unterminated\n---\nbody\n');
	t.false(result.valid);
	t.is(result.errors[0]?.field, 'document');
});

test('requires name and version', t => {
	const result = parseRulePack('---\ndescription: "x"\n---\nbody\n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'name'));
	t.true(result.errors.some(e => e.field === 'version'));
});

test('rejects a non-kebab-case name', t => {
	const result = parseRulePack(
		'---\nname: Solana_Anchor\nversion: 1.0.0\n---\nbody\n',
	);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'name'));
});

test('rejects a non-semver version', t => {
	const result = parseRulePack('---\nname: p\nversion: "1.2"\n---\nbody\n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'version'));
});

test('rejects a severity_weighting value outside the scale', t => {
	const pack = `---
name: p
version: 1.0.0
severity_weighting:
  some-rule: blocker
---
body
`;
	const result = parseRulePack(pack);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'severity_weighting.some-rule'));
});

test('rejects a pack that depends on itself', t => {
	const pack = `---
name: p
version: 1.0.0
depends_on: ["p"]
---
body
`;
	const result = parseRulePack(pack);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'depends_on'));
});

test('rejects an empty body', t => {
	const result = parseRulePack('---\nname: p\nversion: 1.0.0\n---\n\n   \n');
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'body'));
});

test('rejects a malformed applies_to shape', t => {
	const pack = `---
name: p
version: 1.0.0
applies_to:
  paths: "programs/**/*.rs"
---
body
`;
	const result = parseRulePack(pack);
	t.false(result.valid);
	t.true(result.errors.some(e => e.field === 'applies_to.paths'));
});
