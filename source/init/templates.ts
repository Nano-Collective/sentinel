/**
 * Pure content generators for the files `sentinel init` scaffolds. Each returns
 * a string; the generated sentinel.yaml parses under parseConfig and the
 * starter pack parses under parseRulePack (both covered by tests).
 */

import type {InitOptions} from './types.js';

/**
 * Providers Nanocoder reaches on the machine it runs on. The distinction drives
 * the whole scaffold: a local provider needs a runner that has the daemon, and
 * no API key; a cloud provider needs neither a special runner nor a daemon, but
 * does need a secret. Getting this wrong is not a warning — it is a workflow
 * that cannot run.
 */
const LOCAL_ENDPOINTS: Record<string, string> = {
	ollama: 'http://localhost:11434/v1',
	lmstudio: 'http://localhost:1234/v1',
	llamacpp: 'http://localhost:8080/v1',
	mlx: 'http://localhost:8080/v1',
};

export function isLocalProvider(provider: string): boolean {
	return provider.trim().toLowerCase() in LOCAL_ENDPOINTS;
}

/**
 * The Nanocoder release the scaffolded workflow installs. Pinned to a major
 * so a scaffolded install picks up fixes without waking up to a new major.
 */
const NANOCODER_PACKAGE = '@nanocollective/nanocoder@1';

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
# The endpoint and API key for this provider live in agents.config.json.
model:
  provider: ${options.provider}
  model: ${options.model}

# How findings are filed as issues.
issues:
  label: ${options.label}
  aggregate_to_config_repo: false
`;
}

/**
 * The runner the audit runs on, chosen by the provider rather than fixed.
 *
 * A local provider is a daemon on the machine: `ubuntu-latest` does not have
 * one, so scaffolding a hosted runner alongside `provider: ollama` produces a
 * workflow that cannot work. Self-hosted is also the posture the docs call
 * first-class for local models, since the audited code never leaves hardware
 * you own.
 */
function runnerFor(options: InitOptions): string {
	if (!isLocalProvider(options.provider)) {
		return `    runs-on: ubuntu-latest`;
	}
	return `    # ${options.provider} runs on the machine the job runs on, so this needs a
    # self-hosted runner with that provider reachable. Switch to ubuntu-latest
    # only alongside a cloud provider in agents.config.json.
    runs-on: self-hosted`;
}

/**
 * The model credential, for a cloud provider. The same name goes into
 * `agents.config.json` as a `${...}` placeholder, which is what actually
 * reaches Nanocoder — both are generated from `options.endpointSecret` so they
 * agree by construction.
 */
function modelSecretEnv(options: InitOptions): string {
	if (isLocalProvider(options.provider)) {
		return '';
	}
	return `
          # The model endpoint key. agents.config.json references this name as
          # \${${options.endpointSecret}}; add it as an Actions secret.
          ${options.endpointSecret}: \${{ secrets.${options.endpointSecret} }}`;
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

# contents: write lets the run commit its record and dashboard back to this repo.
permissions:
  contents: write
  issues: write

jobs:
  audit:
${runnerFor(options)}
    steps:
      - name: Check out configuration
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      # Sentinel drives Nanocoder; it does not bundle it. Without this step the
      # run fails on its first model call with "nanocoder is not on PATH".
      - name: Install Nanocoder
        run: npm install -g ${NANOCODER_PACKAGE}

      - name: Run Sentinel
        env:
          # A token that can read the audited repos and open issues on them.
          # The default GITHUB_TOKEN only reaches THIS repository, so to audit
          # other repos add a PAT (or GitHub App token) as the SENTINEL_TOKEN
          # secret with repo + issues scope.
          #
          # Sentinel does not pass this to Nanocoder — the model subprocess gets
          # an allowlisted environment, and issues are filed afterwards.
          GH_TOKEN: \${{ secrets.SENTINEL_TOKEN || secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.SENTINEL_TOKEN || secrets.GITHUB_TOKEN }}${modelSecretEnv(options)}
        run: >-
          npx -y @nanocollective/sentinel@latest run
          --workspace "$RUNNER_TEMP/sentinel"
          --output "$GITHUB_STEP_SUMMARY"
          \${{ github.event.inputs.dry_run == 'true' && '--dry-run' || '' }}

      - name: Commit run record, dashboard and incremental cache
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add runs dashboard
          # The incremental cache has to survive between runs or every run finds
          # no cache and re-reads everything — incremental scanning would look
          # enabled and do nothing. Tolerated when absent: a dry run writes none.
          git add .sentinel-cache.json || true
          if ! git diff --cached --quiet; then
            git commit -m "chore: sentinel run record [skip ci]"
            git push
          fi
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
 * The provider entry Nanocoder resolves `model.provider` against.
 *
 * `NANOCODER_CONFIG_DIR` **replaces** Nanocoder's provider list rather than
 * adding to it, so a local provider is not auto-detected once Sentinel points
 * at a config repo — it has to be written here or `--provider ollama` comes
 * back as `Provider 'ollama' not found in agents.config.json`. The entry is
 * named after `sentinel.yaml`'s provider for the same reason: that string is
 * the lookup key, so the two files have to say the same thing.
 */
function providerEntry(options: InitOptions): Record<string, unknown> {
	const key = options.provider.trim().toLowerCase();
	const endpoint = LOCAL_ENDPOINTS[key];
	if (endpoint) {
		return {
			name: options.provider,
			baseUrl: endpoint,
			models: [options.model],
		};
	}
	return {
		name: options.provider,
		baseUrl: 'https://api.example.com/v1 — replace with your endpoint',
		apiKey: `\${${options.endpointSecret}}`,
		models: [options.model],
	};
}

/**
 * A nanocoder `agents.config.json` template. Sentinel points nanocoder at this
 * file (via NANOCODER_CONFIG_DIR) so the provider/model wiring lives in the
 * config repo — the same shape ContentForest uses. The provider entry is
 * generated from the chosen provider rather than left as an example to edit,
 * because pointing Nanocoder at a config repo replaces its provider list: a
 * local provider that is auto-detected on the command line is not found here.
 *
 * `disabledTools` is the part not to delete. The audit runs Nanocoder in
 * auto-approve mode over a repository the operator did not write, with that
 * repository's files in the prompt. Reading code and reporting on it needs no
 * shell, no network fetch, no writes and no sub-agents, so an audit that keeps
 * them is holding capability it never uses. This matches the posture the
 * collective's own review workflow runs under.
 */
export function nanocoderConfig(options: InitOptions): string {
	return `${JSON.stringify(
		{
			nanocoder: {
				disabledTools: [
					// Executes, reaches the network, or spawns more agents.
					'execute_bash',
					'fetch_url',
					'web_search',
					'agent',
					// Writes to the checkout, or pushes from it.
					'file_op',
					'write_file',
					'string_replace',
					'diff_edit',
					'git_add',
					'git_commit',
					'git_pr',
					// Blocks forever on a non-interactive run.
					'ask_user',
				],
				providers: [providerEntry(options)],
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
to Nanocoder — the same shape ContentForest uses.

Both files were generated together and **must keep agreeing**:
\`model.provider\` in \`sentinel.yaml\` is looked up by \`name\` in
\`agents.config.json\`. Sentinel points Nanocoder at this directory, which
replaces its provider list, so there is no auto-detected fallback if they
drift.

${
	isLocalProvider(options.provider)
		? `This install is scaffolded for **${options.provider}**, a local provider, so
the workflow runs on a \`self-hosted\` runner — that is where the daemon lives,
and the audited code never leaves it. To move to a GitHub-hosted runner, swap
in a cloud provider in \`agents.config.json\` and change \`runs-on\`.`
		: `This install is scaffolded for a cloud provider. Add your endpoint key as
an Actions secret named \`${options.endpointSecret}\` — \`agents.config.json\`
references it as \`\${${options.endpointSecret}}\` and the workflow passes it
through under that name.`
}

The audit runs Nanocoder with writes, shell and network access switched off in
\`agents.config.json\`. It reads code and reports; keeping those tools would be
holding capability the audit never uses over code you did not write.

## Layout

- \`sentinel.yaml\` — targets, schedule, model, and issue routing.
- \`agents.config.json\` — Nanocoder provider/model wiring.
- \`rule-packs/\` — your rule packs (you author these).
- \`.github/workflows/sentinel.yml\` — the scheduled audit.
- \`runs/\` — a committed JSON record per run (the durable history).
- \`.sentinel-cache.json\` — what each pack last audited, for incremental runs.
- \`dashboard/\` — a generated static \`index.html\`; serve it via GitHub Pages.
`;
}
