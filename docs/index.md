---
title: "Introduction"
description: "Sentinel is an installable, Nanocoder-driven workflow that runs continuous, configurable security and code audits across a GitHub organisation's repositories and files findings as issues"
sidebar_order: 1
---

# Sentinel

Sentinel is an installable, Nanocoder-driven workflow that runs continuous, configurable security and code audits across the repositories in a GitHub organisation, and files what it finds as issues for a human to act on. It is built by the [Nano Collective](/collective) — a community-led group building open-source AI tools for the people who use them, not for profit.

Most organisations on GitHub have more repositories than they have eyes to keep on them. Hosted SAST platforms are strong on common stacks and weak on emerging ones. Self-hosted scanners put the rule-writing burden on you. Manual audits are the right answer for a launch and far too expensive to run every week. Sentinel fills the gap in between: a cheap, continuous, customisable audit pass across every repo you own, shaped by rule packs you write for the code you actually ship.

## How It Works

You install Sentinel into a fresh repository in your own organisation. That repository holds your configuration and your rule packs — it is separate from the repositories being audited. On a schedule, a GitHub Actions workflow:

1. Reads your configuration to decide which repositories to audit and which rule packs apply to each.
2. Clones each target repository into the workspace.
3. Runs [Nanocoder](https://github.com/Nano-Collective/nanocoder) against a templated audit prompt for each assigned rule pack — the pack's instructions, the relevant source, and any per-repo context.
4. Collects structured findings and validates their shape.
5. Files an issue on the audited repository for each finding above your severity threshold, or updates the existing issue if the finding was already filed.

This is the same shape [ContentForest](https://github.com/Nano-Collective/contentforest) uses for release content, pointed at source code with a security framing and a different output target.

## What Makes It Different

- **Rule packs you own.** A rule pack encodes the patterns a careful reviewer in your ecosystem would already look for — signer checks for a Solana program, reentrancy for EVM Solidity, `unsafe` and panic patterns for Rust, secret leakage for a data pipeline. Sentinel ships none of its own; you write the packs that matter to your code. That is the differentiator over generic SAST.
- **Local-first.** Audit work is exactly where reaching reflexively for a cloud model exposes you. Sentinel makes local Nanocoder providers (Ollama, LM Studio, llama.cpp, MLX) a first-class path. On a self-hosted runner, every byte stays on hardware you own. Cloud is opt-in, never a hidden default.
- **Honest about false positives.** Any LLM-driven audit produces false positives. Sentinel does not pretend otherwise. It surfaces confidence honestly, dedups findings so the same issue is never filed twice, and gives the maintainer a one-close path to suppress a finding for good.

## Get Started

```bash
npx @nanocollective/sentinel init
```

## Next Steps

- [Getting Started](getting-started/index.md) — Install Sentinel into your organisation and get the first run green
- [Rule Packs](rule-packs/index.md) — The pack format and the authoring guide the whole tool leans on
- [Configuration](configuration/index.md) — The `sentinel.yaml` reference
- [Workflow](workflow/index.md) — The scheduled audit, run modes, and the execution model
- [Findings & Issues](findings/index.md) — The severity model, issue filing, dedup, and suppression
- [CLI](cli/index.md) — `init` and `run` command reference
- [Community](community.md) — Get involved

> Sentinel is in active development toward its v1. These docs describe the v1 design settled in the [Sentinel whitepaper](/collective/whitepapers/sentinel). Where a feature is planned rather than shipped, the docs say so.
