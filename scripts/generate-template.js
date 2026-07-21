#!/usr/bin/env node

/**
 * Regenerate the `template/` directory from the same source `sentinel init`
 * uses, so the "Use this template" install path never drifts from the npx one.
 * Run after changing anything under source/init/templates.ts:
 *   pnpm build && node scripts/generate-template.js
 */

import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_INIT_OPTIONS, planInit} from '../dist/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const templateDir = join(rootDir, 'template');

rmSync(templateDir, {recursive: true, force: true});

for (const file of planInit(DEFAULT_INIT_OPTIONS)) {
	const full = join(templateDir, file.path);
	mkdirSync(dirname(full), {recursive: true});
	writeFileSync(full, file.content);
}

console.log(`Regenerated ${templateDir}`);
