---
title: "Workflow"
description: "The scheduled GitHub Actions audit, its execution model, live and dry-run modes, runner and model posture, and run history"
sidebar_order: 5
---

# Workflow

The core of Sentinel is a scheduled GitHub Actions workflow, scaffolded into your config repo by `init` at `.github/workflows/sentinel.yml`. It invokes the `@nanocollective/sentinel` package at run time — so upgrading is a version bump in the workflow, not a re-scaffold.

## Execution model

A scheduled run flows like this:

1. The workflow triggers on its cron [schedule](../configuration/index.md#schedule).
2. It reads `sentinel.yaml` to determine which repositories to audit this run.
3. For each target, it clones the repo at its default branch into a fresh workspace.
4. For each rule pack assigned to that target, it runs Nanocoder against the templated audit prompt — the pack's body, the relevant source files (scoped by `applies_to.paths`), and any per-repo context.
5. Nanocoder produces a structured findings output. The [validator](#validation) checks its shape. On a hard failure, an auto-fix step re-runs the agent with the structured error report; on success, the orchestrator moves on.
6. For each finding at or above the [severity threshold](../findings/index.md#severity) that is not already filed, it opens an issue on the target repo. Findings matching an existing issue update that issue's last-seen timestamp.
7. A run record is committed to the config repo and a run summary is written, with cross-repo metrics aggregated for the maintainer.

This is the [ContentForest](https://github.com/Nano-Collective/contentforest) orchestration pattern — cron, Nanocoder, templated prompt, validator, structured output, dedup'd downstream action — with the inputs and the output target swapped for security work.

## Validation

Findings are validated against a small set of hard rules before anything is filed:

- The output is well-formed JSON.
- Every finding's `severity` is within the allowed set (`low`, `medium`, `high`, `critical`).
- Every finding cites at least one file and a line range.

A hard-validation failure triggers one auto-fix pass: the agent runs again with the structured error report describing what was malformed. This is the same validation-and-retry loop ContentForest uses.

## Run modes

Both modes ship in v1. Choose per dispatch (dry-run is available via `workflow_dispatch`).

### Live (default)

Does the full audit and files issues for every qualifying finding. The **first live run files everything at once** — there is no summary-only first pass and no per-repo staging. A noisy first run is your calibration signal. Tune the packs and the [severity threshold](../configuration/index.md#severity_threshold) from there.

### Dry-run

Does the full audit but files **nothing**. It renders the candidate findings as a Markdown preview grouped into:

- **Would file as new** — findings that would open a fresh issue.
- **Dedup would have matched** — findings an existing issue already covers.
- **Below severity threshold** — findings that ran but sit under the filing floor.

The preview is written to the Actions step summary and saved as a run artefact. Dry-run is the calibration path for a new install tuning its config and for a new pack being validated against the dedup and threshold logic — the last gate before real issues land.

## Runner and model posture

Two supported shapes:

- **GitHub-hosted runner (`ubuntu-latest`) + configured cloud model endpoint** — the out-of-the-box default for installs that do not stand up their own runner. Be honest about what this means: the audited code leaves the runner and is sent to the configured endpoint. That path is explicit configuration, never hidden behaviour. The endpoint is operator-chosen; Sentinel ships no model recommendation.
- **Self-hosted runner + local Nanocoder provider** — the fully-supported, first-class local-first path. Every byte of audited code stays on hardware you own. This is the intended posture for sensitive code, and the one the project optimises for.

Sentinel is not a model and does not train one. It uses whichever Nanocoder-configured providers you point it at. If your threat model needs pre-send scrubbing before code reaches a cloud endpoint, compose the workflow with a content-layer tool that fits — that is out of Sentinel's own scope.

## Observability and run history

There is no database. Run history is:

- **Step summary** — the immediate run's result, in the Actions run.
- **Run record** — a committed record per run, in the config repo. This is the durable store.
- **Dashboard** — a lightweight static site generated into the config repo's GitHub Pages from the committed run records. The read-side surface for trends: per-pack hit rates, findings over time, and aggregate model cost per run.

## Triggers in v1

Scheduled runs are the only trigger in v1. **PR-triggered runs are phase 2** — the check-run, comment, and race-condition surface is deferred. The v1 finding output is deliberately shaped so a future PR-triggered surface can consume it without a data-model change.
