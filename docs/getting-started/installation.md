---
title: "Installation"
description: "Requirements and the two install paths for Sentinel — the npx scaffolder and the from-template fallback"
sidebar_order: 1
---

# Installation

Sentinel installs into a dedicated configuration repository inside your GitHub organisation. There are two ways to create it; both converge on the same files.

## Requirements

- A GitHub organisation (or user account) with the repositories you want to audit.
- Permission to create a repository in that organisation and to enable GitHub Actions.
- For the default hosted-runner path: a model provider endpoint and a token, stored as an Actions secret. For the local-first path: a self-hosted runner with a Nanocoder-compatible provider (Ollama, LM Studio, llama.cpp, MLX).
- To run the scaffolder or a local audit: [Node.js](https://nodejs.org/) 22+.

You do **not** need to install a GitHub App, authenticate against any Nano Collective service, or exchange a token with anyone. The install runs entirely inside your organisation.

## Path 1: the `init` scaffolder (recommended)

Create a fresh, empty repository in your organisation (e.g. `sentinel-config`), clone it, then from inside it run:

```bash
npx @nanocollective/sentinel init
# or
pnpm dlx @nanocollective/sentinel init
```

`init` is interactive. It asks the obvious questions — which model provider, which schedule, which repositories to start with — and scaffolds:

- `sentinel.yaml` — your [configuration](../configuration/index.md)
- `.github/workflows/sentinel.yml` — the scheduled [audit workflow](../workflow/index.md)
- `rule-packs/` — an empty directory for the packs you write
- `rule-packs/_starter/` — a starter pack template demonstrating every manifest field, **not auto-enabled** (see below)
- `README.md` — pointing back at the pack authoring documentation

For scripted, non-interactive installs, every prompt has a corresponding flag — see the [CLI reference](../cli/index.md#init).

### The same package is the runtime

The workflow that `init` writes invokes the same package at run time (`pnpm dlx @nanocollective/sentinel run`). That means you get bug fixes by bumping one version in the workflow — you do not re-scaffold. Your rule packs live in the config repo and are never touched by an upgrade.

## Path 2: from a template repository (fallback)

If you would rather not run an npm command, the same configuration shape is published as a GitHub template repository. Click **Use this template**, create your config repo from it, and edit the generated files. The template is produced from the same source as the `init` output, so the two paths land on identical files.

## The starter pack, and why it is disabled

`init` writes `rule-packs/_starter/`, an illustrative pack that demonstrates every manifest field. The leading underscore is a deliberate signal: **it is template content, and Sentinel does not load it.** Nothing in `_starter/` runs.

To use it, opt in explicitly — remove the `_` prefix or copy the file to a real path under `rule-packs/`, then edit it into a pack that describes *your* code. This is the guard rail against a fresh install auditing against a generic example pack nobody read.

## Next

- [Quick Start](quick-start.md) — walk from here to your first filed issue.
- [Writing a Rule Pack](../rule-packs/authoring.md) — the document the empty-out-of-the-box state lives or dies on.
