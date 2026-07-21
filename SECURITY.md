# Security Policy

Sentinel is a security tool that reads source code, so the integrity of the
package itself matters more than for most projects. This document covers how to
report a vulnerability and the supply-chain posture of the project.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately via [GitHub's private vulnerability reporting](https://github.com/Nano-Collective/sentinel/security/advisories/new),
or email **hello@nanocollective.org** with the details and, where possible, a
reproduction. We aim to acknowledge reports within a few days.

Please include:

- What the vulnerability allows.
- Affected version(s).
- Reproduction steps or a proof of concept.
- Any suggested remediation.

## Scope

In scope:

- Vulnerabilities in the `@nanocollective/sentinel` package (the scaffolder, the
  run runtime, issue filing, dedup, the validator).
- The scaffolded GitHub Actions workflow shipping insecure defaults.

Out of scope (by design — see the [whitepaper threat model](https://docs.nanocollective.org/collective/whitepapers/sentinel#threat-model)):

- The quality of findings a given rule pack produces — false positives and
  negatives are inherent to LLM-driven audits and are a tuning concern, not a
  vulnerability.
- Rule packs themselves; they are plain files owned by the installing
  organisation.

## Supply-chain posture

Because a compromised Sentinel install has outsized consequences, the project:

- Publishes to npm from GitHub Actions with **build provenance** (`npm publish
  --provenance`), so the published tarball is attestably built from this repo.
- **Pins GitHub Actions to commit SHAs** in its own CI/release workflows.
- Enforces a **dependency audit**, **dead-code detection**, and **static
  analysis** (Semgrep) on every change, and a **minimum release-age** quarantine
  on new dependency versions.

Handling secrets: Sentinel never logs tokens or model API keys. The audited
code and model calls follow the paths the operator configures explicitly (local
model on a self-hosted runner keeps everything local; a configured cloud
endpoint receives the audited code — never hidden behaviour).
