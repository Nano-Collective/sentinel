# Contributing to Sentinel

Thanks for your interest in contributing to Sentinel! We welcome contributions from everyone, at every skill level.

Sentinel is part of the [Nano Collective](https://nanocollective.org). The Nano Collective's [Code of Conduct](https://docs.nanocollective.org/collective/organisation/community#code-of-conduct) applies to all contributors. Some contribution work is paid via scoped bounties from the community fund — see the [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) for how that works.

For the collective-wide guidance on finding work, contribution modes, and what review looks like, read [Contributing to a Nano Collective project](https://docs.nanocollective.org/collective/projects/contributing). The guidance below is Sentinel-specific and takes precedence where the two differ.

## Requirements

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 11+
- A local Nanocoder provider (Ollama, LM Studio, llama.cpp, or MLX) is recommended for exercising the audit path without a cloud key.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies with `pnpm install`
4. Build the project with `pnpm build`
5. Run the full gate with `pnpm test:all`

`pnpm test:all` is the single catch-all command: it runs formatting, type checking, linting, and the test suite. Run it before opening a PR.

## How to Contribute

### Just open the PR

For bug fixes, docs corrections, dependency bumps, and small self-contained improvements, open the PR directly — no need to ask first.

### Propose first

For new features, changes to the CLI surface, the `sentinel.yaml` schema, the rule pack manifest format, or the findings data model, raise an issue (or a message in [Discord](https://discord.gg/ktPDV6rekE)) before you start. These surfaces are contracts other people's installs depend on, so we want to agree the shape early.

### Rule packs

Sentinel ships **no rule packs** as product. Please do not open PRs adding general-purpose rule packs to this repository. If you have written a pack worth sharing, publish it in your own repository — the pack format is designed to be portable with a `cp`. NC maintains a small set of clearly-illustrative example packs; changes to those are welcome.

## Coding Standards

- TypeScript with strict mode enabled.
- Follow the existing code patterns; match the surrounding style.
- Use descriptive names; prefer `const`/`let` over `var`; `async`/`await` over callbacks.
- Code is auto-formatted and linted with Biome (`pnpm format`).
- The findings data model, the `sentinel.yaml` schema, and the rule pack manifest format are versioned contracts. Treat changes to them as breaking until proven otherwise, and update the docs in the same PR.

## Testing

All new features and bug fixes should include appropriate tests. The validator, the dedup hash, and the issue-routing logic are the highest-value things to cover — they are what keep an install from spamming a maintainer's issue tracker.

## Releases

Contributors do not bump versions. Cutting a release is a maintainer responsibility. Because Sentinel's runtime is invoked from every install's workflow, releases follow the collective's tighter supply-chain posture — see [Creating a New Project](https://docs.nanocollective.org/collective/projects/creating-a-new-project) for the CI and release conventions.

## Commit Messages

Follow the collective's light Conventional Commits convention: `feat:`, `fix:`, `mod:`, `chore(deps):`, `docs:`. Lowercase, imperative mood, no trailing period. Scope is optional in parentheses (`feat(config): ...`).
