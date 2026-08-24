---
title: "CLI"
description: "The @nanocollective/sentinel command-line interface — init and run"
sidebar_order: 7
---

# CLI

The `@nanocollective/sentinel` package is both the scaffolder and the runtime. It exposes three commands: `init` scaffolds a config repo, `run` performs an audit, and `estimate` sizes an audit before you run it. The scheduled [workflow](../workflow/index.md) invokes `run` under the hood, and you can invoke any of them directly.

```bash
npx @nanocollective/sentinel <command> [options]
# or
pnpm dlx @nanocollective/sentinel <command> [options]
```

## `init`

Scaffolds a Sentinel configuration into the current (fresh) repository: `sentinel.yaml`, the GitHub Actions workflow, an empty `rule-packs/` directory, the disabled `rule-packs/_starter/` template, and a README pointing at the pack authoring docs.

```bash
npx @nanocollective/sentinel init
```

Interactive by default — it asks which model provider, which schedule, and which repositories to start with. For scripted installs, every prompt has a flag:

| Flag | Description |
| --- | --- |
| `--provider <name>` | Model provider (`ollama`, `lmstudio`, `llamacpp`, `mlx`, or a cloud provider). |
| `--model <id>` | Model identifier for the chosen provider. |
| `--schedule <cron>` | Cron expression for the scheduled run (UTC). |
| `--targets <list>` | Comma-separated `owner/repo` targets to seed `sentinel.yaml`. |
| `--yes` | Accept defaults for anything not supplied; run non-interactively. |

After `init`: review the generated files, write your [first rule pack](../rule-packs/authoring.md), commit, and push.

## `run`

Performs an audit pass. This is the same code path the workflow uses, so a local `run` is a faithful preview of what the scheduled run will do.

```bash
npx @nanocollective/sentinel run \
  --rule-pack ./rule-packs/my-pack.md \
  --repo ../target-repo \
  --output findings.md
```

| Flag | Description |
| --- | --- |
| `--rule-pack <path>` | Path to the rule pack file to run. Repeatable to run several. |
| `--repo <path>` | Path to the repository to audit (a local checkout). |
| `--output <path>` | Where to write the findings Markdown. Defaults to stdout / a local file. |
| `--dry-run` | In the Actions context, do the full audit but file no issues (see [run modes](../workflow/index.md#run-modes)). |

### Local run vs. Actions run

A local `run` **writes findings to a Markdown file and never files issues** — issue filing needs a GitHub token, which is only present in the Actions path. This makes local `run` the [calibration path](../rule-packs/authoring.md#calibrate-before-you-file) for pack authors: iterate on a pack against a real repo, read the Markdown, adjust, repeat, all without touching anyone's issue tracker.

The same validator, dedup logic, and findings model apply in both contexts, so what you see locally is what the workflow will produce.

## `estimate`

Sizes an audit **before** it runs: how many repositories and rule packs are in scope, how many files they put in front of the model, and roughly how many model requests, tokens, and minutes that costs. It runs no model, files nothing, and mutates nothing — useful when you are about to point Sentinel at a dozen more repositories, or adding a pack to every target and want to know what that does to the nightly window.

```bash
npx @nanocollective/sentinel estimate
```

```markdown
# Sentinel audit estimate

- **Repositories:** 18
- **Rule packs:** 5
- **Files:** 1,204
- **Estimated AI requests:** ~420
- **Estimated tokens:** ~3.8M
- **Estimated runtime:** ~14 minute(s)

Calibrated from the last 6 run record(s).
```

| Flag | Description |
| --- | --- |
| `--config <path>` | Path to `sentinel.yaml`. Defaults to `./sentinel.yaml`. |
| `--packs-dir <path>` | Rule packs directory. Defaults to `rule-packs/` beside the config. |
| `--workspace <path>` | Where the target repos are checked out. Defaults to `.`. |
| `--records-dir <path>` | Run records to calibrate from. Defaults to `runs`. |
| `--clone` | Check out any target repo not already present in the workspace. |
| `--output <path>` | Write the Markdown estimate here. Defaults to stdout. |

### How the figures are produced

The token figure is **measured, not guessed**: `estimate` assembles the same prompts the audit would send — the pack body, the reporting contract, and the source files scoped by each pack's `applies_to.paths` — and counts them. What varies between installs is the per-request cost, so the request, token, and runtime figures are calibrated from the run records the last ten runs committed. Every run is instrumented for this: it records how long each pack pass took, how many model requests it made (auto-fix retries included), and the tokens it sent and received.

Until a run has been recorded, the figures fall back to built-in defaults, and the output says so. Treat a first, uncalibrated estimate as an order of magnitude rather than a number to schedule against.

Repositories already checked out under `--workspace` are measured from their real files. Any that are not are counted with zero files and called out in the output, so a partial estimate never reads as the whole picture — pass `--clone` to check the rest out first.
