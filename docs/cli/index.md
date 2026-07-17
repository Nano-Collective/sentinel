---
title: "CLI"
description: "The @nanocollective/sentinel command-line interface — init and run"
sidebar_order: 7
---

# CLI

The `@nanocollective/sentinel` package is both the scaffolder and the runtime. It exposes two commands: `init` scaffolds a config repo, and `run` performs an audit. The scheduled [workflow](../workflow/index.md) invokes `run` under the hood, and you can invoke either directly.

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
