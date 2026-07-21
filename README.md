# Sentinel

Built by the [Nano Collective](https://nanocollective.org) — a community collective building AI tooling not for profit, but for the community.

Sentinel is an installable, Nanocoder-driven workflow that runs continuous, configurable security and code audits across the repositories in a GitHub organisation, and files what it finds as issues for a human to act on.

You install Sentinel into your own organisation, point it at the repositories you care about, write the rule packs that describe what to look for, and a scheduled GitHub Actions workflow does the audit pass. Findings land as issues on the affected repository, written up for a reviewer. Local models are a first-class path, so the audited code never has to leave hardware you own.

> Sentinel is in active development toward its v1. This repository and its documentation describe the v1 design settled in the [Sentinel whitepaper](https://docs.nanocollective.org/collective/whitepapers/sentinel). Features are being built; where something is planned rather than shipped, the docs say so.

---

![Build Status](https://github.com/Nano-Collective/sentinel/raw/main/badges/build.svg)
![Coverage](https://github.com/Nano-Collective/sentinel/raw/main/badges/coverage.svg)
![Version](https://github.com/Nano-Collective/sentinel/raw/main/badges/npm-version.svg)
![NPM Downloads](https://github.com/Nano-Collective/sentinel/raw/main/badges/npm-downloads-monthly.svg)
![NPM License](https://github.com/Nano-Collective/sentinel/raw/main/badges/npm-license.svg)
![Stars](https://github.com/Nano-Collective/sentinel/raw/main/badges/stars.svg)

## Quick Start

From inside a fresh repository in your GitHub organisation:

```bash
npx @nanocollective/sentinel init
# or
pnpm dlx @nanocollective/sentinel init
```

`init` scaffolds the configuration (`sentinel.yaml`), the scheduled GitHub Actions workflow, an empty `rule-packs/` directory, and a starter pack template. Answer the prompts (model provider, schedule, first repositories), review the generated files, write your first rule pack, commit, and push. The first scheduled run lands later that day, or you can dispatch the workflow manually.

Sentinel ships **no rule packs of its own**. The value comes from the packs you write for the code you actually ship — see [Writing a Rule Pack](docs/rule-packs/authoring.md).

You can also run an audit locally, off-cycle, for calibrating a pack:

```bash
npx @nanocollective/sentinel run \
  --rule-pack ./rule-packs/solana-anchor.md \
  --repo ../my-program \
  --output findings.md
```

## Documentation

Full documentation is available online at **[docs.nanocollective.org](https://docs.nanocollective.org/sentinel/docs)** or in the [docs/](docs/) folder:

- **[Getting Started](docs/getting-started/index.md)** — Install Sentinel into your organisation and get the first run green
- **[Rule Packs](docs/rule-packs/index.md)** — The pack format, the authoring guide, and worked examples
- **[Configuration](docs/configuration/index.md)** — The `sentinel.yaml` reference
- **[Workflow](docs/workflow/index.md)** — The scheduled audit, run modes, and the execution model
- **[Findings & Issues](docs/findings/index.md)** — The severity model, issue filing, dedup, and suppression
- **[CLI](docs/cli/index.md)** — `init` and `run` command reference
- **[Community](docs/community.md)** — Contributing, Discord, and how to help

## What Sentinel is not (in v1)

Sentinel is a triage layer, not a replacement for a real audit. It is **not** a substitute for a formal security audit, **not** a SAST replacement (run Semgrep/CodeQL alongside it), **not** a secret scanner, **not** a hosted service, **not** a rule pack catalogue, and **not** a fix-it tool — it files issues, it does not open PRs. See the [whitepaper](https://docs.nanocollective.org/collective/whitepapers/sentinel) for the full scope.

## Community

The Nano Collective is a community collective building AI tooling for the community, not for profit. We'd love your help.

- **Contribute**: See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
- **The collective**: [nanocollective.org](https://nanocollective.org) · [docs](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **Support the work**: The [Support page](https://docs.nanocollective.org/collective/organisation/support) covers donations and sponsorship.
- **Paid contribution**: The [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) sets out how scoped paid bounties work.
