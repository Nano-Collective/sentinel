---
title: "Writing a Rule Pack"
description: "How to write a rule pack the model can act on — severity language, true and false positive examples, and suppression patterns"
sidebar_order: 1
---

# Writing a Rule Pack

This is the most important document in the Sentinel docs. Sentinel ships no rule packs, so a fresh install does nothing until you write one — and a thin pack produces thin, noisy results. The difference between Sentinel reading as a curiosity and Sentinel catching the bug a reviewer would have caught is almost entirely the quality of the pack.

A rule pack is a single file: a [YAML manifest](index.md#manifest-fields) followed by a Markdown body. The manifest is metadata. The **body is the audit prompt** handed to the model. This guide is about writing that body well.

## The mental model

Write the pack as if you are briefing a competent reviewer who is new to your codebase. They know how to read code; they do not know your conventions, which patterns you have decided are acceptable, or which ones burned you last quarter. Everything a new reviewer would need in a code-review onboarding doc belongs in the pack.

The best raw material already exists in most teams: code-review checklists, the "things we always look for" list, post-incident write-ups, and the bookmarks of ecosystem guidance you have collected over the years. A pack is that knowledge written down where the model can use it.

## Anatomy of a good body

A pack body that produces good findings has four parts. Present them in roughly this order.

### 1. Framing: what is this code?

Open by telling the model what it is looking at and from what perspective.

```markdown
# What this pack audits

You are reviewing an Anchor-based Solana program. These programs handle
user funds, so access-control and account-validation bugs are high-impact.
Review the instruction handlers under `programs/**/*.rs`.
```

### 2. What to flag

List the patterns, concretely. Vague instructions ("look for security issues") produce vague findings. Name the bug class, describe how it shows up in this stack, and say why it matters.

```markdown
## Flag these

- **Missing signer check.** An instruction that mutates an account but never
  asserts that the expected authority signed the transaction. In Anchor this
  is a handler using an `AccountInfo` where a `Signer` constraint was expected.
- **Account confusion.** Two accounts of the same type where the handler does
  not validate which is which, letting a caller substitute one for the other.
```

### 3. Severity guidance, in your words

The model assigns a severity to each finding. Tell it how you weigh things, using the [four-tier scale](../findings/index.md#severity). Be explicit about what earns `critical` versus `high` — that boundary is where a security tool's value concentrates.

```markdown
## Severity guidance

- Missing signer check on a fund-moving instruction: **critical**.
- Missing signer check on a read-only or metadata instruction: **high**.
- Account confusion where the accounts have different authorities: **high**.
- A convention deviation with no security consequence: **low**.
```

You can also encode the coarse version of this in the manifest's `severity_weighting`; the body is where the nuance lives.

### 4. What NOT to flag — the suppression section

This is the part most first-draft packs skip, and it is what separates a signal-rich pack from a noisy one. Describe the patterns that *look* like findings but are fine in your codebase. Every false positive you can pre-empt here is one the maintainer does not have to dismiss later.

```markdown
## Do not flag

- Handlers guarded by the project's `#[access_control(...)]` macro — the check
  is there, just not inline.
- PDA derivations under `programs/vault/` — that module is exempt from the seed
  convention by design; see its module docs.
- `unwrap()` in `#[cfg(test)]` modules and build scripts.
```

## Writing for confidence

Sentinel carries a separate `confidence` value on every finding, distinct from severity. Encourage the model to use it. When a pattern has known exceptions the model cannot fully verify from the code alone, say so — tell it to file the finding at lower confidence rather than suppress it or over-assert it.

```markdown
Some PDA derivations are legitimately exempt. If you cannot tell from the code
whether a derivation is exempt, file the finding at **low confidence** and note
the ambiguity in the rationale, rather than asserting it is a bug.
```

Low-confidence findings still surface, but a maintainer reads them differently — and honest confidence is what keeps a maintainer reading findings at all.

## Keep packs focused

Prefer several small, single-purpose packs over one sprawling pack:

- **A focused pack is easier to tune.** When it is noisy, you know which pack to edit.
- **Packs compose.** Assign an ecosystem pack, a language-general pack, and an organisation-conventions pack to the same repo. Use `depends_on` to pull a base pack in automatically.
- **Focused packs share better.** A tight `solana-anchor` pack is something another team can lift; a pack tangled with your internal conventions is not.

## Calibrate before you file

Do not tune a pack by watching issues appear on a teammate's repo. Iterate locally:

```bash
npx @nanocollective/sentinel run \
  --rule-pack ./rule-packs/my-pack.md \
  --repo ../target-repo \
  --output findings.md
```

The local run does the full audit and writes findings to Markdown without filing anything. Read the output, adjust the body, and re-run until the true-positive rate is good and the noise is low. Then [dry-run the workflow](../workflow/index.md#run-modes) for a final check against the dedup and threshold logic before going live.

## Version your changes

Bump the manifest `version` whenever you change the body. Findings record the pack version that produced them, so a version bump keeps the audit trail honest and makes it possible to reason about why a finding's shape changed between runs.

## A checklist

A pack is ready when:

- [ ] The framing says what the code is and from what perspective to review it.
- [ ] Each pattern to flag is concrete — bug class, how it appears here, why it matters.
- [ ] Severity guidance is explicit, especially the `critical` vs `high` boundary.
- [ ] A "do not flag" section pre-empts the obvious false positives.
- [ ] The pack tells the model when to lower confidence rather than guess.
- [ ] It is focused enough that you know what to edit when it misbehaves.
- [ ] You have calibrated it with a local run against a real repo.

See the [example packs](examples.md) for complete, worked bodies you can study.
