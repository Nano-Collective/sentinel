---
title: "Quick Start"
description: "A step-by-step walkthrough from sentinel init to your first filed issue"
sidebar_order: 2
---

# Quick Start

This walkthrough goes from an empty repository to a scheduled audit filing real issues. It assumes you have [installed the scaffold](installation.md).

## 1. Scaffold the config repo

Create a fresh repository in your organisation, clone it, and run:

```bash
npx @nanocollective/sentinel init
```

Answer the prompts. You now have `sentinel.yaml`, `agents.config.json`, a workflow, an empty `rule-packs/`, and the disabled `_starter/` pack.

**The provider you answer here decides the shape of the workflow.** Pick a local one (`ollama`, `lmstudio`, `llamacpp`, `mlx`) and `init` scaffolds `runs-on: self-hosted`, because that is where the daemon lives. Pick a cloud provider and it scaffolds `runs-on: ubuntu-latest` and wires the Actions secret you named for the endpoint key. Getting this pair wrong is the difference between a workflow that runs and one that cannot, so `init` keeps them in step for you.

## 2. Make sure the model is reachable

Before the workflow can audit anything, the runner it lands on has to be able to reach the model.

**Local provider (the default).** You need a [self-hosted runner](https://docs.github.com/actions/hosting-your-own-runners) registered to this repository, with your provider running on it and the model pulled. Check it from the runner's own shell:

```bash
ollama list          # the model in sentinel.yaml should appear
```

**Cloud provider.** Edit the provider block in `agents.config.json` to your real endpoint, then add the key as an Actions secret under the name it references (`SENTINEL_MODEL_KEY` unless you chose another). The workflow passes that one name through; nothing else in the job's environment reaches the model.

Nanocoder itself needs no setup — the workflow installs it.

## 3. Point it at a repository

Open `sentinel.yaml` and set your first target and schedule. Start with **one** repository and **one** pack — you are calibrating, not covering everything on day one.

```yaml
targets:
  - repo: my-org/my-first-service

schedule: "0 6 * * *"        # daily at 06:00 UTC

severity_threshold: medium   # file medium and above; lower findings appear in the summary only

model:
  provider: ollama           # local-first; see configuration docs for cloud
  model: llama3.1:70b
```

See the [configuration reference](../configuration/index.md) for every field.

## 4. Write your first rule pack

This is the step that matters. Copy the starter as a starting point and rewrite it for your code:

```bash
cp rule-packs/_starter/example.md rule-packs/my-first-pack.md
```

A rule pack is a single file: a YAML manifest header followed by a Markdown body that *is* the audit prompt. A minimal one:

```markdown
---
name: my-first-pack
version: 0.1.0
applies_to:
  paths: ["src/**/*.ts"]
  languages: ["typescript"]
category: correctness
---

# What to audit

You are reviewing a TypeScript service. Flag:

- User input reaching a database query without parameterisation (SQL injection).
- Unbounded queries that could return the whole table.

## Severity guidance
- SQL injection on a user-facing path: **high**.
- Unbounded query in a hot path: **medium**.

## Do not flag
- Parameterised queries using the project's query builder — those are safe.
```

Then assign it to your target in `sentinel.yaml`. Read [Writing a Rule Pack](../rule-packs/authoring.md) before you go further — a thin pack produces thin results, and this is where the tool earns its keep.

## 5. Calibrate locally before you file anything

Before the first scheduled run files issues on a teammate's repo, run the pack locally and read what it would produce. A local run drives Nanocoder on *this* machine, so install it here too:

```bash
npm install -g @nanocollective/nanocoder

npx @nanocollective/sentinel run \
  --rule-pack ./rule-packs/my-first-pack.md \
  --repo ../my-first-service \
  --provider ollama \
  --model llama3.1:70b \
  --output findings.md
```

A local run does the full audit and writes findings to a Markdown file. It **never files issues** (that needs a GitHub token, only present in the Actions path). Iterate on the pack here until the signal is good.

## 6. Dry-run the workflow

Push your config, then dispatch the workflow in **dry-run** mode from the Actions tab. Dry-run does the full audit but files nothing — it renders the candidate findings as a Markdown preview grouped into *would file as new*, *dedup would have matched*, and *below severity threshold*. This is your last calibration gate before real issues land.

## 7. Go live

Switch to live and let the schedule fire (or dispatch it manually). The first live run files **all** qualifying findings at once — there is no summary-only first pass. A noisy first run is your calibration signal, not a bug; tune the pack and the severity threshold from there.

Findings land as issues on the audited repository, labelled `sentinel`, each citing a file and line range with a rationale and suggested next steps. Close one as `false-positive` and Sentinel reads the close and stops refiling it. See [Findings & Issues](../findings/index.md) for the full lifecycle.

## What next

- [Writing a Rule Pack](../rule-packs/authoring.md) — get more out of every run.
- [Configuration](../configuration/index.md) — add targets, tune routing, wire up a cloud fallback.
- [Findings & Issues](../findings/index.md) — the severity model, dedup, and suppression.
