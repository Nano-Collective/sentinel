---
title: "Findings & Issues"
description: "The findings data model, the severity and confidence scale, issue filing, content-hash dedup, and the three-layer suppression model"
sidebar_order: 6
---

# Findings & Issues

A finding is one thing a rule pack flagged. When a finding meets your [severity threshold](../configuration/index.md#severity_threshold), Sentinel files it as an issue on the affected repository. This page covers the shape of a finding, how issues are filed and deduplicated, and the honest reality that an LLM-driven audit produces false positives — and what Sentinel does about it.

## The findings data model

Every finding carries a structured set of fields. These are a **stable contract**: rich enough that a future auto-fix surface could consume them without a migration, even though v1 does not open PRs.

| Field | Description |
| --- | --- |
| `rule` | The rule pack (and pattern within it) that produced the finding. |
| `file` | The affected file. |
| `line_range` | The line range within that file. |
| `category` | The finding's category (`security`, `correctness`, `performance`, `convention`, …), carried from the pack. |
| `severity` | One of `low`, `medium`, `high`, `critical`. See below. |
| `confidence` | The model's confidence in the finding, distinct from severity. |
| `offending_snippet` | The relevant code excerpt. |

The issue body adds a human-facing layer on top: a short summary, the rationale for the severity, and suggested next steps — the kind of note a reviewer leaves at the bottom of a code-review comment. Not patches; next steps.

## Severity

Sentinel uses a deliberate four-tier scale, with `confidence` and `category` as separate values. The fourth tier above `high` exists because for security work the cost of confusing "a notable pattern" with "a missing signer check or a leaked production credential" is asymmetric.

| Severity | Meaning |
| --- | --- |
| `critical` | Exploitable or catastrophic. A missing signer check on a fund-moving path, a leaked live credential. Act now. |
| `high` | Serious and likely real. Warrants prompt review. |
| `medium` | Worth fixing; not urgent. The typical default filing floor. |
| `low` | Minor or stylistic. Usually surfaced in the summary rather than filed. |

There is no CVSS-style numeric scoring — that is overkill for an LLM-driven tool. `confidence` is what a maintainer reads alongside severity: a `high`/low-confidence finding reads very differently from a `high`/high-confidence one, and a good [rule pack](../rule-packs/authoring.md#writing-for-confidence) tells the model when to lower its confidence rather than guess.

## Issue filing

When a finding meets the threshold, the issue body includes:

- A short summary of the finding.
- The affected file(s), with line ranges.
- The rule pack that produced it, linked to the pack.
- The severity, and the rationale for that severity.
- Suggested next steps.
- A footer naming Sentinel as the source, linking the config repo, and explaining how to dismiss the finding if it is a false positive.

Every issue is labelled with your configured [label](../configuration/index.md#issues) (default `sentinel`). By default issues file on the audited repo; set `aggregate_to_config_repo: true` to route them all to the config repo instead.

## Dedup

Sentinel must never file the same issue twice. Dedup is enforced by a **content hash** over the finding's salient fields:

- the rule pack,
- the file,
- the line range,
- the finding type.

A later run that produces the same finding **updates the existing issue's last-seen timestamp** instead of opening a duplicate. A finding that stops appearing across N consecutive runs is marked resolved automatically.

## Suppression

False positives are inherent to any LLM-driven audit. Sentinel does not try to eliminate them before release — it makes them cheap to dismiss, the same way a reviewer marks a comment resolved. There are three layers, in increasing specificity:

1. **Content-hash dedup (the floor).** Automatic. The same finding is never filed twice; see above.
2. **Per-finding labels.** A maintainer closes or labels an individual issue:
   - `sentinel:false-positive` — the finding is wrong. Sentinel reads the close and **never refiles it**.
   - `sentinel:accepted` — acknowledged and accepted as-is.
   - `sentinel:wontfix` — real, but not being fixed.
3. **Per-repo `sentinel.yaml`.** For systematic noise on one repository, an opt-in [`sentinel.yaml` in the audited repo](../configuration/index.md#per-repository-overrides-sentinelyaml-in-an-audited-repo) is the escape hatch — repo-specific exemptions that do not belong in a shared pack.

Reach for the least specific layer that solves the problem. A one-off wrong finding is a label; a whole category of noise on one repo is a config entry; a pattern that is wrong everywhere is a fix to the [rule pack's "do not flag" section](../rule-packs/authoring.md#4-what-not-to-flag--the-suppression-section).

## Honest about false positives

This is a first-class principle, not a disclaimer. A tool that pretends its findings are all real trains its users to either click through everything or stop reading. Sentinel's answer is: surface confidence honestly, dedup so nothing is filed twice, respect a `false-positive` close permanently, and keep the suppression path lighter than the finding is worth. The signal quality still depends on your rule packs and your model — but the flow around the findings is built to keep a maintainer trusting them.
