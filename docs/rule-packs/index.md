---
title: "Rule Packs"
description: "What a rule pack is, the v1 manifest format, and how packs are assigned to repositories"
sidebar_order: 3
---

# Rule Packs

A rule pack is the unit of customisation that makes Sentinel useful. It is a single file describing what to audit for, in a form the underlying model can act on. Sentinel ships **no rule packs of its own** — you write the packs that describe the code you actually ship, and that is the whole point.

Why no defaults? Two reasons. Shipping default packs would commit the Nano Collective to maintaining an audit ruleset across every ecosystem the packs claim to cover. And a good pack is opinionated about the codebase it audits — the organisation that owns the code is the right author. What the project ships instead is this format, the [authoring guide](authoring.md), and a small set of clearly-illustrative [example packs](examples.md).

## In This Section

- [Writing a Rule Pack](authoring.md) — the guide the tool's value depends on: severity language, false-positive suppression, and what works
- [Example Packs](examples.md) — worked examples published from NC's own audits, marked illustrative

## Anatomy of a pack

A rule pack is **one file**: a YAML manifest header followed by a Markdown body. The manifest is metadata; the Markdown body *is* the audit prompt handed to the model.

```markdown
---
name: solana-anchor
version: 1.2.0
description: "Signer checks, account confusion, and PDA derivation for Anchor programs"
applies_to:
  paths: ["programs/**/*.rs"]
  languages: ["rust"]
severity_weighting:
  missing-signer-check: high
  account-confusion: high
  pda-derivation: medium
depends_on: ["rust-general"]
category: security
---

# What this pack audits

You are reviewing an Anchor-based Solana program...
(the rest of the Markdown body is the audit prompt — see the authoring guide)
```

One file per pack is deliberate: it is easy to install (`cp`), easy to diff, and easy to lift into a shared repository.

## Manifest fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Unique pack identifier. Kebab-case. Used in finding output and issue footers. |
| `version` | yes | Semver. Bump it when you change the audit body; findings record the pack version that produced them. |
| `description` | recommended | One line describing what the pack audits for. |
| `applies_to.paths` | recommended | Glob patterns for the files this pack should read (e.g. `programs/**/*.rs`). Omit to apply to the whole repo. |
| `applies_to.languages` | optional | Language identifiers the pack targets. A hint for scoping and reporting. |
| `severity_weighting` | optional | Per-finding-type overrides mapping a finding key to a severity. Lets one pack express that some patterns it looks for are inherently more serious than others. |
| `depends_on` | optional | Other packs that should run alongside this one (e.g. a language-general pack). |
| `category` | recommended | The pack's primary category (`security`, `correctness`, `performance`, `convention`, …). Carried onto findings. |

The manifest format is a **stable v1 contract**. Fields may be added; existing fields will not change meaning without a major version and a migration note.

## The Markdown body

Everything below the manifest is the prompt. This is where a pack lives or dies. A good body includes what to flag, severity guidance in the pack's own words, examples of true positives, and — critically — examples of false positives the model should suppress. The [authoring guide](authoring.md) covers how to write each of these well.

## Assigning packs to repositories

Packs are assigned in [`sentinel.yaml`](../configuration/index.md), not inside the pack. A repository can pull in several: an ecosystem pack, a language-general pack, and an organisation-specific pack of your own internal patterns.

```yaml
targets:
  - repo: my-org/my-program
    rule_packs: [solana-anchor, rust-general, org-conventions]
  - repo: my-org/indexer
    rule_packs: [node-server, org-conventions]
```

The `applies_to.paths` on each pack narrows which files within a matched repo the pack actually reads. The combination of "ecosystem pack + language pack + organisation pack" behind one workflow with one output format is the arrangement existing tools do not offer.

## Sharing packs

The pack format is the natural unit for sharing — a pack one organisation writes is a pack another can install with a `cp`. Any community catalogue sits **outside** Sentinel; the project does not run, host, or curate one. The format is open and documented; what the community builds on it is up to the community.
