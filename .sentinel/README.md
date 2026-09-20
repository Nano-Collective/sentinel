# Sentinel auditing Sentinel

This directory is a **real Sentinel install**, not a fixture. The workflow at
[`.github/workflows/sentinel.yml`](../.github/workflows/sentinel.yml) runs the
published `@nanocollective/sentinel` package against this repository on a
schedule, the same way any other config repo does.

## Why it exists

Because it did not, and that cost four bugs.

Every other part of this organisation's infrastructure gets exercised across
seven repositories — the shared release workflow, the review agent, the badge
cron, the gate checks. The one thing that never was is the artefact Sentinel
itself produces: the config a new user gets from `sentinel init`. It went three
releases without anyone running it end to end, and when someone finally did, the
scaffolded workflow could not work at all. Nanocoder was never installed, the
default runner could not reach the default provider, the model key was never
passed, and `agents.config.json` defined a different provider than
`sentinel.yaml` named.

Every one of those was an *absence*. Reading the code does not surface an
absence; running it does. So this install exists to keep running it.

It is deliberately the **same shape** `sentinel init` scaffolds — install
Nanocoder, point `NANOCODER_CONFIG_DIR` at a directory that defines the
provider, pass only the model key to the subprocess. If the scaffolded shape
breaks, this breaks too, on the next morning's run rather than three releases
later.

## Layout

| Path | What it is |
| --- | --- |
| `sentinel.yaml` | The config. One target: this repository. |
| `agents.config.json` | Provider wiring and the audit tool posture. |
| `rule-packs/` | The packs. See below. |
| `runs/` | A committed JSON record per run — the durable history. |
| `dashboard/` | Generated static `index.html`. |
| `cache.json` | Incremental state. Currently unused; see `sentinel.yaml`. |

Everything lives under `.sentinel/` so the package repository's root stays the
package's.

## The packs

Two, both written against what actually goes wrong in this codebase rather than
generic TypeScript advice:

- **`silent-failure`** — the project's signature bug class. A result that
  reports success, or nothing, when the work did not happen. Every bug fixed in
  the run-up to `1.0.0` was one of these: a swallowed error, an unguarded `fs`
  call that abandoned every repository after it, a failed audit reporting `0
  findings` and exiting `0`.
- **`untrusted-content`** — the three kinds of content Sentinel handles that it
  did not write: files from audited repositories, model output, and issue
  bodies edited by anyone with write access. Includes credential scope, which is
  where the org-wide token reaching the model subprocess was found.

Both are scoped to hand-listed directories rather than `source/**/*.ts`,
because `applies_to.paths` cannot exclude and this repository's specs are nearly
as large as its source — the union blew past the model's context window on the
first run. See [#48](https://github.com/Nano-Collective/sentinel/issues/48).

## Running it by hand

Dry-run from the Actions tab (**Sentinel** → *Run workflow* → dry run), which
audits everything and files nothing. Do that before trusting a scheduled live
run after any change to the packs.

Locally, against a model you can reach:

```bash
npm install -g @nanocollective/nanocoder

sentinel run \
  --config .sentinel/sentinel.yaml \
  --config-dir .sentinel \
  --workspace "$(mktemp -d)" \
  --dry-run --no-record --no-dashboard
```

Swap `model.provider` / `model.model` in a copy of `sentinel.yaml` if your local
provider is not the one CI uses.

## What it needs

- `MINIMAX_API_KEY` as an organisation secret — the same one `nc-review` uses.
  `agents.config.json` references it by name, which is what allows it through
  to the model subprocess at all.
- Nothing else. The default `GITHUB_TOKEN` covers reading this repository and
  filing issues on it, so no PAT is involved.
