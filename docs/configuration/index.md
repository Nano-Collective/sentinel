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
    provider: <cloud-provider>     # must name a provider in agents.config.json
    model: <model-id>

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
| `incremental` | Re-audit only files that changed since the last successful pass. Off by default — see below. |

A repo's assigned packs, combined with each pack's `applies_to.paths`, determine which files are read. See [Rule Packs](../rule-packs/index.md#assigning-packs-to-repositories).

#### `incremental`

Re-auditing a whole repository when a handful of files moved is the dominant cost as an install grows. Setting `incremental: true` on a target limits each pack to the files that changed since that pack last completed a pass.

```yaml
targets:
  - repo: my-org/my-program
    rule_packs: [solana-anchor, rust-general]
    incremental: true
```

It is **off by default and opt-in per target**, because it trades a complete re-read for speed, and that is a trade to make on a repository you know rather than to inherit.

**A pack re-reads everything whenever anything is uncertain.** Being wrong about needing to re-read costs some model time; being wrong about *not* needing to costs a missed finding. Those are not close, so a full pass happens when:

- the target has no cached pass yet (the first run, always);
- the pack changed — its version, its prompt body, its `applies_to`, its `severity_weighting` or its `category`. A pack edited in place asks a different question, or asks it of different files, and either way the answers have to be redone. Notably this does **not** rely on you bumping the version: widening `applies_to` without a bump would otherwise leave the newly-applicable files skipped indefinitely;
- a pack it `depends_on` changed, for the same reason: a dependency's body is part of this pack's prompt;
- the cached commit is unreachable — a shallow clone, or a force-push that orphaned it. *Cannot tell* is not *nothing changed*;
- `--full` was passed.

The run report says which packs re-read everything and why, so a target that opted in and got no speed-up explains itself.

A pack whose audit **failed** records nothing. Advancing the cache after an errored pass would let the next run skip files on the strength of an audit that never happened.

If a repository matches several targets, incremental applies only when **every** one of them opted in — otherwise a target expecting a complete re-read would quietly stop getting one.

The cache is a JSON file (`.sentinel-cache.json` by default, `--cache-file` to move it) committed to the configuration repo beside the run records. There is no database. A cache that is missing, unreadable or written by a newer schema is treated as empty, which means the run reads everything.

Skipping files is only safe because auto-resolution knows what was read: an open issue whose file this run did not read is **held** rather than aged towards being closed. See [findings](../findings/index.md#auto-resolution-only-counts-runs-that-looked).

### `schedule`

A cron expression (UTC) for the scheduled run. Daily is the sensible default. Every audited repo × every assigned pack is a model call, so the schedule interacts directly with cost — see [cost](#a-note-on-cost) below. In v1 the schedule is the only trigger; PR-triggered runs are phase 2.

### `severity_threshold`

The floor for filing issues. Findings below it still run and appear in the run summary, but do not open issues. One of `low`, `medium`, `high`, `critical`. See the [severity model](../findings/index.md#severity).

### `model`

Which Nanocoder provider to use. **Local-first is the intended posture**: `ollama`, `lmstudio`, `llamacpp`, and `mlx` keep the audited code on hardware you own when run on a self-hosted runner. A cloud provider under `fallback` is used only when the primary struggles, and its use is explicit configuration — on a GitHub-hosted runner calling a cloud endpoint, the audited code leaves the runner and goes to that endpoint. See [Workflow → runner and model posture](../workflow/index.md#runner-and-model-posture).

| Key | Description |
| --- | --- |
| `provider` | The provider to run against. Passed to Nanocoder as `--provider`, so it must name one Nanocoder knows — a built-in, or an entry in your `agents.config.json`. |
| `model` | The model id, which must be one that provider offers. |
| `fallback` | Optional `provider` + `model` used only when the primary struggles. Switching to it switches both. |

**Where the key lives.** `sentinel.yaml` names *which* model to run; the wiring that reaches it — endpoint, API key — lives in `agents.config.json`, which is the file Nanocoder reads. Reference the key there by name (`"apiKey": "${SENTINEL_MODEL_KEY}"`) and set that name as an Actions secret; never inline it.

**`maxOutputTokens` is not optional on a cloud provider.** The AI SDK derives a model's output ceiling from its id and falls back to **4096** for anything it does not recognise — which is every model behind a compatible endpoint that is not that vendor's own. Left unset, a pack that reasons before it answers is truncated mid-sentence having never emitted the findings array, and a run with nothing parseable **reads as "no findings" rather than as a failure**. `init` writes a conservative `32000` into the entry it scaffolds; keep it, and set one by hand if you add a provider yourself.

That placeholder is also what lets the key through to the model at all — the subprocess environment is an allowlist, and `${...}` references in `agents.config.json` are what populate it. See [What the model subprocess can see](../workflow/index.md#what-the-model-subprocess-can-see).

> `model.fallback.endpoint_secret` was removed before `1.0.0`. It named the
> Actions secret, but nothing read it, and `agents.config.json` already names
> the same thing in the place that is actually consulted. A config still
> carrying the key keeps loading — unknown fields are ignored — it simply has
> no effect, as before.

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

To put numbers on a specific config before committing to it, run [`sentinel estimate`](../cli/index.md#estimate) — it reports the requests, tokens, and runtime the config implies, calibrated from your own recorded runs.

## Observability

Each run commits a run record to the config repo and writes a step summary. A lightweight static dashboard is generated into the config repo's GitHub Pages from those committed records — no database. See [Workflow → observability](../workflow/index.md#observability-and-run-history).
