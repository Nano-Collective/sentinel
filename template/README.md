# Sentinel configuration

This repository configures [Sentinel](https://docs.nanocollective.org/sentinel/docs)
for your organisation. It audits the repositories listed in `sentinel.yaml` on a
schedule and files findings as issues.

## Getting started

Sentinel ships **no rule packs** — it does nothing until you write one.

1. Edit `sentinel.yaml`: set your real `targets` and the model you want.
2. Write your first rule pack in `rule-packs/`. A disabled example lives in
   `rule-packs/_starter/example.md`; copy it to `rule-packs/<name>.md` and edit.
   See the [authoring guide](https://docs.nanocollective.org/sentinel/docs/rule-packs/authoring).
3. Commit and push. The audit runs on its schedule (`0 6 * * *`), or
   dispatch the **Sentinel** workflow manually (use dry-run first).

## Model configuration

`sentinel.yaml` names *which* model to use (id + provider). The provider
*wiring* (endpoint, API key) lives in `agents.config.json`, which Sentinel hands
to Nanocoder — the same shape ContentForest uses. Local providers (Ollama, LM
Studio) are usually auto-detected and need no entry; for a cloud provider, edit
the example block and set its key as an environment variable / Actions secret.

## Layout

- `sentinel.yaml` — targets, schedule, model, and issue routing.
- `agents.config.json` — Nanocoder provider/model wiring.
- `rule-packs/` — your rule packs (you author these).
- `.github/workflows/sentinel.yml` — the scheduled audit.
- `runs/` — a committed JSON record per run (the durable history).
- `dashboard/` — a generated static `index.html`; serve it via GitHub Pages.
