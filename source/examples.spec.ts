import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {parseRulePack} from './rule-packs/parse.js';

console.log('\nexamples.spec.ts');

// Every published example pack must parse — a broken worked example is worse
// than none. ava runs from the repo root, so the path is relative to cwd.
const EXAMPLES_DIR = join(process.cwd(), 'examples', 'rule-packs');

const packFiles = readdirSync(EXAMPLES_DIR).filter(
	name => name.endsWith('.md') && name !== 'README.md',
);

test('there are example packs to validate', t => {
	t.true(packFiles.length >= 3);
});

for (const file of packFiles) {
	test(`example pack ${file} parses and is well-formed`, t => {
		const result = parseRulePack(
			readFileSync(join(EXAMPLES_DIR, file), 'utf8'),
		);
		t.true(result.valid, JSON.stringify(result.errors));
		t.truthy(result.pack?.manifest.name);
		t.truthy(result.pack?.manifest.category);
		// A real pack has a substantive body, not just a heading.
		t.true((result.pack?.body.length ?? 0) > 200);
	});
}
