---
title: "Configuration"
description: "The sentinel.yaml reference — targets, rule pack assignment, schedule, severity threshold, model, and issue routing"
sidebar_order: 4
---

# Configuration

All of Sentinel's behaviour is configured in a single `sentinel.yaml` at the root of your configuration repository. It is plain files in plain Git: a change to who gets audited is a pull request like any other. There is **one** configuration per install — one `sentinel.yaml`, one workflow, one schedule. (Multi-config installs are a phase-2 consideration.)

## A complete example

```yaml
# Which repositories to audit, and which packs apply to each.
targets:
  - repo: my-org/my-program
    rule_packs: [solana-anchor, rust-general, org-conventions]
  - repo: my-org/indexer
    rule_packs: [node-server, org-conventions]
  - pattern: "my-org/web-*"        # glob over repos in the org
    rule_packs: [web-frontend]

# When the scheduled audit runs (cron, UTC).
schedule: "0 6 * * *"              # daily at 06:00

# Below this severity, findings appear in the run summary but do not file issues.
severity_threshold: medium         # one of: low | medium | high | critical

# Which Nanocoder provider and model to use. Local by default.
model:
  provider: ollama                 # ollama | lmstudio | llamacpp | mlx | <cloud provider>
  model: llama3.1:70b
  fallback:                        # optional: used only when the primary demonstrably struggles
    provider: <cloud-provider>
    model: <model-id>
    endpoint_secret: SENTINEL_MODEL_KEY   # name of the Actions secret holding the key

# Where findings go.
issues:
  label: sentinel                  # label applied to every filed issue
  assignee: null                   # optional GitHub login to assign
  aggregate_to_config_repo: false  # default false = file on the audited repo
```

## Reference

### `targets`

A list of repositories to audit. Each entry is either an explicit `repo:` or a `pattern:` glob over the organisation, plus the `rule_packs` that apply to it.

| Key | Description |
| --- | --- |
| `repo` | A single `owner/name` repository. |
| `pattern` | A glob matching multiple repositories in the org. Combine with allow/deny as needed. |
| `rule_packs` | The list of pack names (from `rule-packs/`) to run against this target. |

A repo's assigned packs, combined with each pack's `applies_to.paths`, determine which files are read. See [Rule Packs](../rule-packs/index.md#assigning-packs-to-repositories).

### `schedule`

A cron expression (UTC) for the scheduled run. Daily is the sensible default. Every audited repo × every assigned pack is a model call, so the schedule interacts directly with cost — see [cost](#a-note-on-cost) below. In v1 the schedule is the only trigger; PR-triggered runs are phase 2.

### `severity_threshold`

The floor for filing issues. Findings below it still run and appear in the run summary, but do not open issues. One of `low`, `medium`, `high`, `critical`. See the [severity model](../findings/index.md#severity).

### `model`

Which Nanocoder provider to use. **Local-first is the intended posture**: `ollama`, `lmstudio`, `llamacpp`, and `mlx` keep the audited code on hardware you own when run on a self-hosted runner. A cloud provider under `fallback` is used only when the primary struggles, and its use is explicit configuration — on a GitHub-hosted runner calling a cloud endpoint, the audited code leaves the runner and goes to that endpoint. Store any key as an Actions secret referenced by name; never inline it. See [Workflow → runner and model posture](../workflow/index.md#runner-and-model-posture).

### `issues`

Controls issue filing.

| Key | Default | Description |
| --- | --- | --- |
| `label` | `sentinel` | Label applied to every issue Sentinel files. |
| `assignee` | none | Optional GitHub login to assign filed issues to. |
| `aggregate_to_config_repo` | `false` | When `false`, findings file on the audited repo. When `true`, everything routes to the config repo instead. |

## Per-repository overrides: `sentinel.yaml` in an audited repo

Systematic noise on one repository is handled with an opt-in `sentinel.yaml` placed **in that audited repo**. It is the most specific of the three [suppression layers](../findings/index.md#suppression) and lets a repo's maintainer tune what Sentinel files there without touching the central config. Use it for repo-specific exemptions that do not belong in a shared rule pack.

## A note on cost

Cost scales with repositories × rule packs × schedule frequency. Twenty repos with four packs each, run daily, is eighty model calls a day. Local models keep that cost at zero; cloud models do not. Keep the default configuration modest, lean on local models for the routine passes, and reserve a cloud fallback for the cases that genuinely need it.

## Observability

Each run commits a run record to the config repo and writes a step summary. A lightweight static dashboard is generated into the config repo's GitHub Pages from those committed records — no database. See [Workflow → observability](../workflow/index.md#observability-and-run-history).
