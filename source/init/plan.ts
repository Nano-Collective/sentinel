/**
 * The file plan for a scaffold: sentinel.yaml, the scheduled workflow, the
 * disabled starter pack (which also creates rule-packs/), and the config
 * README. Pure — the writer applies it.
 */

import {
	configReadme,
	sentinelYaml,
	starterPack,
	workflowYaml,
} from './templates.js';
import type {InitOptions, ScaffoldFile} from './types.js';

/** The ordered set of files `sentinel init` scaffolds. */
export function planInit(options: InitOptions): ScaffoldFile[] {
	return [
		{path: 'sentinel.yaml', content: sentinelYaml(options)},
		{path: '.github/workflows/sentinel.yml', content: workflowYaml(options)},
		{path: 'rule-packs/_starter/example.md', content: starterPack()},
		{path: 'README.md', content: configReadme(options)},
	];
}
