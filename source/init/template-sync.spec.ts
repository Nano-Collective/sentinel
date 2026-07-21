import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'ava';
import {planInit} from './plan.js';
import {DEFAULT_INIT_OPTIONS} from './types.js';

console.log('\ninit/template-sync.spec.ts');

// The committed template/ directory is the "Use this template" install path. It
// must stay byte-identical to what `sentinel init` scaffolds. Regenerate with:
//   pnpm build && node scripts/generate-template.js
const TEMPLATE_DIR = join(process.cwd(), 'template');

for (const file of planInit(DEFAULT_INIT_OPTIONS)) {
	test(`template/${file.path} matches the scaffolder output`, t => {
		const onDisk = readFileSync(join(TEMPLATE_DIR, file.path), 'utf8');
		t.is(
			onDisk,
			file.content,
			`template/${file.path} is stale — run "pnpm build && node scripts/generate-template.js"`,
		);
	});
}
