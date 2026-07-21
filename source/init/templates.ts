/**
 * Pure content generators for the files `sentinel init` scaffolds. Each returns
 * a string; the generated sentinel.yaml parses under parseConfig and the
 * starter pack parses under parseRulePack (both covered by tests).
 */

import type {InitOptions} from './types.js';

function targetsBlock(targets: string[]): string {
	const list = targets.length > 0 ? targets : ['your-org/your-repo'];
	return list
		.map(
			repo =>
				`  - repo: ${repo}\n    rule_packs: [example] # replace with your pack names`,
		)
		.join('\n');
}

/** The `sentinel.yaml` config, seeded from the init options. */
export function sentinelYaml(options: InitOptions): string {
	return `# Sentinel configuration — one file per install.
# Docs: https://docs.nanocollective.org/sentinel/docs/configuration

# Repositories to audit and the rule packs that apply to each.
targets:
${targetsBlock(options.targets)}

# When the scheduled audit runs (cron, UTC).
schedule: "${options.schedule}"

# Findings below this severity appear in the summary but do not file issues.
severity_threshold: ${options.severityThreshold} # low | medium | high | critical

# Which Nanocoder provider and model to use. Local-first by default.
model:
  provider: ${options.provider}
  model: ${options.model}

# How findings are filed as issues.
issues:
  label: ${options.label}
  aggregate_to_config_repo: false
`;
}

/** The scheduled GitHub Actions audit workflow. */
export function workflowYaml(options: InitOptions): string {
	return `name: Sentinel

on:
  schedule:
    - cron: "${options.schedule}"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Run the full audit but file no issues"
        type: boolean
        default: false

# One audit at a time; never cancel an in-progress run.
concurrency:
  group: sentinel
  cancel-in-progress: false

permissions:
  contents: read
  issues: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Check out configuration
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Run Sentinel
        env:
          # A token that can read the audited repos and open issues on them.
          # The default GITHUB_TOKEN only reaches THIS repository, so to audit
          # other repos add a PAT (or GitHub App token) as the SENTINEL_TOKEN
          # secret with repo + issues scope.
          GH_TOKEN: \${{ secrets.SENTINEL_TOKEN || secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.SENTINEL_TOKEN || secrets.GITHUB_TOKEN }}
        run: >-
          npx -y @nanocollective/sentinel@latest run
          --workspace "$RUNNER_TEMP/sentinel"
          --output "$GITHUB_STEP_SUMMARY"
          \${{ github.event.inputs.dry_run == 'true' && '--dry-run' || '' }}
`;
}

/**
 * The disabled starter pack. The leading underscore in its directory keeps
 * Sentinel from loading it; the user opts in by copying it to a real path. It
 * exercises every manifest field and the four body sections from the authoring
 * guide.
 */
export function starterPack(): string {
	return `---
name: example
version: 0.1.0
description: "Illustrative starter pack — demonstrates every manifest field. Not enabled."
applies_to:
  paths: ["src/**/*.ts"]
  languages: ["typescript"]
severity_weighting:
  sql-injection: critical
  unbounded-query: medium
depends_on: []
category: security
---

# What this pack audits

You are reviewing a TypeScript service. This is an illustrative example — replace
it with rules that describe the code your organisation actually ships.

## Flag these

- **SQL injection.** User input reaching a database query without parameterisation.
- **Unbounded query.** A query that can return an entire table with no limit.

## Severity guidance

- SQL injection on a user-facing path: **critical**.
- An unbounded query in a hot path: **medium**.

## Do not flag

- Parameterised queries built with the project's query builder — those are safe.
- Queries in \`**/*.spec.ts\` test files.
`;
}

/**
 * A nanocoder `agents.config.json` template. Sentinel points nanocoder at this
 * file (via NANOCODER_CONFIG_DIR) so the provider/model wiring lives in the
 * config repo — the same shape ContentForest uses. Local providers (Ollama,
 * LM Studio) are usually auto-detected and need no entry here; the example
 * below is a cloud provider to edit or delete.
 */
export function nanocoderConfig(): string {
	return `${JSON.stringify(
		{
			nanocoder: {
				providers: [
					{
						name: 'Example cloud provider — edit or remove',
						sdkProvider: 'anthropic',
						baseUrl: 'https://api.example.com/anthropic/v1',
						apiKey: '${SENTINEL_MODEL_KEY}',
						models: ['example-model'],
					},
				],
			},
		},
		null,
		2,
	)}\n`;
}

/** The config repo README pointing at the pack authoring docs. */
export function configReadme(options: InitOptions): string {
	return `# Sentinel configuration

This repository configures [Sentinel](https://docs.nanocollective.org/sentinel/docs)
for your organisation. It audits the repositories listed in \`sentinel.yaml\` on a
schedule and files findings as issues.

## Getting started

Sentinel ships **no rule packs** — it does nothing until you write one.

1. Edit \`sentinel.yaml\`: set your real \`targets\` and the model you want.
2. Write your first rule pack in \`rule-packs/\`. A disabled example lives in
   \`rule-packs/_starter/example.md\`; copy it to \`rule-packs/<name>.md\` and edit.
   See the [authoring guide](https://docs.nanocollective.org/sentinel/docs/rule-packs/authoring).
3. Commit and push. The audit runs on its schedule (\`${options.schedule}\`), or
   dispatch the **Sentinel** workflow manually (use dry-run first).

## Model configuration

\`sentinel.yaml\` names *which* model to use (id + provider). The provider
*wiring* (endpoint, API key) lives in \`agents.config.json\`, which Sentinel hands
to Nanocoder — the same shape ContentForest uses. Local providers (Ollama, LM
Studio) are usually auto-detected and need no entry; for a cloud provider, edit
the example block and set its key as an environment variable / Actions secret.

## Layout

- \`sentinel.yaml\` — targets, schedule, model, and issue routing.
- \`agents.config.json\` — Nanocoder provider/model wiring.
- \`rule-packs/\` — your rule packs (you author these).
- \`.github/workflows/sentinel.yml\` — the scheduled audit.
`;
}
