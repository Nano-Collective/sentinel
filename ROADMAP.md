# Sentinel Roadmap

Current version: **`0.1.0-alpha.3`** · No GitHub release cut yet · 96.19% coverage

This document is the path from the current alpha to v1, and from v1 to the v1.1
that lets Sentinel audit the Nano Collective's own infrastructure. It is written
to be executed in order, with enough specificity that each item can be picked up
without rediscovering the problem first.

Context for why v1.1 matters beyond this repo:
[`ops-scaling-strategy.md`](https://github.com/Nano-Collective/docs) in the docs
repo. In short — the collective has decided Sentinel is the tool that will check
every repo in the org for conformance, rather than standing up a separate
checker. That makes Sentinel's own correctness an operational dependency.

---

## Where things stand

| | Count |
|---|---|
| Open PRs | 3 (all `addyCooks`, 22–24 Aug, none draft) |
| Open issues | 11 — 7 bugs, 4 features |
| Releases cut | **0** |
| Coverage | 96.19% |

Release plumbing is already in place: `release.yml` triggers on push to `main`
and publishes when `package.json`'s version is ahead of npm, moving the `latest`
tag onto each prerelease until a stable version claims it (that was the whole
content of `alpha.3`). **Cutting a release is a version bump plus a changelog
entry** — there is no changesets ceremony in this repo, and none is needed
before v1.

---

## Phase 0 — Merge what is already open → `0.1.0-alpha.4`

Every open PR closes an open issue. This is the cheapest progress available and
it takes the backlog from 11 issues to 8.

| PR | Closes | Substance |
|---|---|---|
| **#12** surface aged / suppressed / override counts in the run summary | **#11** | `ReconcileResult` already carried `incremented`, `suppressed` and `suppressedByOverride`; the CLI and the persisted run record dropped them, so a pack author calibrating suppressions could not tell whether `sentinel:false-positive` markers were doing anything |
| **#13** reject non-integer and out-of-range line numbers | **#6** | `validateLineRange` gated on `typeof === 'number'`, letting `Infinity`, `NaN` and fractional values through — `start < 1 \|\| end < start` is false for all of them, so a hallucinated `line_range` validated cleanly |
| **#14** `sentinel estimate` + per-run model instrumentation | **#1** (partial) | Enhancement 1 of #1. Incremental scanning (enhancement 2) is deliberately excluded — it needs schema sign-off on the cache |

**Order:** #13 first (it is a correctness fix in the findings path that the other
two do not touch), then #12, then #14.

**Then cut `0.1.0-alpha.4`:** bump `package.json`, write the `CHANGELOG.md`
entry in the existing voice (what changed and why it mattered, not a commit
list), merge to `main`. `release.yml` does the rest.

**Also in this release:** issue **#9** — a stale header comment claims
`sentinel run` is unimplemented. It is a one-line docs fix and it is actively
misleading, so it should not wait for a later phase.

---

## Phase 1 — The error-surfacing class → `0.1.0-alpha.5`

**This is the most important work in the roadmap.** Four of the seven open bugs
are the same failure mode: an error is detected, collected, and then silently
discarded. Fix them as one change, not four.

The reason this is a priority rather than tidiness: Sentinel is being given the
job of reporting whether an organisation's repos are correctly configured. The
failure mode of an auditing tool that swallows errors is **a green report over a
broken estate** — worse than having no tool, because it is trusted. The product
needs "if something went wrong, you will hear about it" as a structural
property before it can hold that job.

### #4 — `packLoadErrors` collected but never surfaced

`source/run/run.ts:82` declares `packLoadErrors: PackLoadError[]` on the result
type and `:235` populates it with `loaded.errors`. **Nothing ever reads it.** It
is returned from `run()` and neither `cli.ts` nor `run/report.ts` renders it. A
rule pack that fails to parse is silently absent from the audit.

*Fix:* render `packLoadErrors` in the run report, and make a non-empty list
visible in the CLI summary.

### #5 — Dependency errors swallowed into `missingPacks`

`source/run/run.ts:137–150`:

```ts
const resolved = resolveDependencies(loaded.packs, name);
if (resolved.errors.length > 0) {
    missingPacks.push(name);   // ← a resolution failure, reported as "missing"
    continue;
}
```

`source/run/report.ts:56` then renders that list as
`> Missing packs (not in rule-packs/): …`. So a pack that **exists** but has a
broken dependency graph is reported to the user as not being in `rule-packs/` —
which is not merely unhelpful, it is false, and it sends the reader to look for
a file that is sitting right there.

*Fix:* separate the two states. `missingPacks` keeps its meaning; add a distinct
channel carrying `resolved.errors` so the report can say what actually failed.

### #7 — `ensureLabels` silently drops gh CLI failures

`source/issues/gh-client.ts:167–174`:

```ts
async ensureLabels({repo, labels}): Promise<void> {
    // Best effort: a label that already exists or a transient failure must not
    // abort the run — filing tolerates a missing label per issue.
    for (const label of labels) {
        runGh(buildGhLabelArgs(repo, label));   // ← return value discarded
    }
}
```

The design intent in the comment is right — this genuinely should not abort a
run. But the result is discarded entirely, so there is no record that anything
failed. Note that `listIssues`, twelve lines below, checks `result.status !== 0`
and throws: the codebase already has the pattern, this call site just does not
use it.

*Fix:* keep best-effort semantics, collect the failures, and surface them in the
run summary. "Three labels could not be created" is a useful sentence; silence
is not.

### #8 — `readFileSync(configPath)` unhandled

`source/cli.ts:240`:

```ts
const parsed = parseConfig(readFileSync(configPath, 'utf8'));
if (!parsed.valid || !parsed.config) {
    for (const error of parsed.errors) {
        console.error(`config error — ${error.field}: ${error.message}`);
    }
    return 1;
}
```

There is a clean error path immediately below — and a missing or unreadable
`sentinel.yaml` never reaches it, because the `readFileSync` throws first and
the user gets a raw ENOENT stack trace. This is the **first thing a new user
hits** if they run `sentinel run` outside a configured directory.

*Fix:* wrap the read and route failures through the same `config error —`
reporting path.

**Then cut `0.1.0-alpha.5`.** This release is worth describing in the changelog
as a class of fix rather than four bullets: errors are now surfaced rather than
swallowed.

---

## Phase 2 — Remaining correctness → `0.1.0-alpha.6`

### #2 — `prepareRepo` accepts stale / partial clone directories

`source/run/clone.ts:33–35`:

```ts
if (existsSync(dir)) {
    return {ok: true, skipped: true};
}
```

Any directory that exists counts as a valid checkout. An empty directory, a
half-finished clone from an interrupted run, or a stale checkout of a previous
revision all return `ok: true`. The audit then runs against whatever is there
and reports success.

For an auditing tool this is the most consequential bug in the backlog after the
error-surfacing class — it produces **findings against stale source, presented
as current**.

*Fix:* verify the directory is a git checkout (`.git` present), that it is not
empty, and ideally that its remote matches the requested repo. On mismatch,
either re-clone or return `ok: false` with a clear reason.

*Note:* `clone.ts` sits inside a `/* c8 ignore */` block, so the 96.19% coverage
figure does not cover this file. Whatever fix lands here needs tests that
actually run.

### #3 — `--rule-pack` documented as repeatable but only one is read

`source/cli.ts:218` reads `flagStr(flags, 'rule-pack')` — a single value —
while the help text at `:130` presents it as the mechanism for choosing packs in
local mode.

*Fix:* collect repeated occurrences into an array and run all of them, or
correct the documentation. Prefer the former; running two packs locally is a
reasonable thing to want.

**Then cut `0.1.0-alpha.6`** — or roll this phase into the v1 release if it
lands quickly, since only two items remain.

---

## Phase 3 — v1

All 7 bugs and all 3 PRs are done. Four things stand between that and `1.0.0`.

### 3a. Publish the whitepaper

`README.md:9` and `docs/index.md:47` both state that this repository
"describe[s] the v1 design settled in the [Sentinel whitepaper]" and link to
`https://docs.nanocollective.org/collective/whitepapers/sentinel`.

**That URL returns 404.** There is no `sentinel.md` in the docs repo's
`content/collective/whitepapers/` directory — the only "Sentinel" string there
is a frontmatter *example* in `index.md`. The document defining v1 scope is not
published, while two user-facing pages send readers to it.

**Decided:** publish it, with status `Building` rather than opening a 30-day
public review window. Sentinel is already built; a review window for a shipped
design would be theatre, but a published scope document that v1 can be checked
against is worth having — particularly now the collective's own conformance
checking depends on this product.

Flip the status to `Shipped` when `1.0.0` lands.

Two details to settle when writing it:

- The frontmatter carries `review_opens` and `review_closes`, described in the
  docs index as driving the status badge. A retro-published whitepaper has no
  review window, so either omit them or record the dates the design was actually
  settled. Check how the badge renders when they are absent.
- `proposer: "Will Lamerton"`, `proposer_github: "will-lamerton"`.

### 3b. #10 — Enforce `severity_weighting`

`severity_weighting` is parsed from the manifest into
`manifest.severityWeighting` (`source/rule-packs/types.ts:31`) and passed into
the prompt by `buildAuditPrompt` — but nothing compares the model's emitted
severity against it. A pack declaring
`severity_weighting.missing-signer-check: critical` can have the model emit
`low` and pass validation cleanly.

The feature's entire purpose is making severity authoritative per pack, and it
is currently advisory in practice while reading as enforced.

*Fix:* after `validateFindings` returns, walk the surviving findings and, for
each `finding.rule` with a key in the active pack's `severityWeighting`,
**overwrite** `finding.severity` with the manifest value — "the pack's word is
law."

The issue records an alternative (reject the finding with a validation error on
mismatch). Overwriting is simpler and does not punish an otherwise accurate
finding with a retry, so prefer it — but whichever lands must be documented,
because the two behaviours are indistinguishable to a pack author until one
fires.

### 3c. #1 (second half) — Incremental scanning

The half deliberately excluded from PR #14, pending sign-off on the cache
schema. Rerunning a full audit when a handful of files changed is the dominant
cost as Sentinel scales across an org.

**The schema question, concretely.** `source/observe/types.ts` already defines
`RunRecord` — a durable per-run record committed to the config repo and read
back by the dashboard (`cli.ts:190`). It carries timestamp, mode, per-repo and
per-pack findings, severity counts, filing totals and target errors.

What it does **not** carry is scan provenance: which commit each repo was at,
which file states each pack actually saw. That is precisely what incremental
scanning needs. So the decision is:

- extend `RunRecord` with per-repo commit SHA and per-pack file-state
  provenance, and let the existing durable store double as the cache; or
- introduce a separate cache artifact and leave `RunRecord` as a reporting
  surface.

Prefer the first — there is already a committed, versioned per-run store, and a
second one invites the two drifting apart.

**Add a `schemaVersion` field to `RunRecord` in the same change.** It does not
have one today, and the dashboard reads every historical record back. Once
records exist in two shapes with nothing distinguishing them, the reader has to
guess. This costs one field now and a migration later.

**This is why doing it before `1.0.0` is the right call.** `RunRecord` is a
committed artifact with a stability expectation the moment a stable version
ships. Settling its shape while still on alpha is free; changing it afterwards
is a migration.

One design fork to settle (see open questions): git-diff-based change detection
is simplest but assumes git history is present, which `--no-clone` and local
mode may not guarantee. Content hashing works everywhere but reads every file.

### 3d. Cut v1

Bump to `1.0.0`. `release.yml` already handles the prerelease → stable
transition: the `latest` tag stops being force-moved and is claimed by the
stable version naturally.

Before tagging, re-audit the README's "where something is planned rather than
shipped, the docs say so" caveat against what v1 actually contains, and flip the
whitepaper status to `Shipped`.

---

## Phase 4 — v1.1: auditing the collective

v1.1 is where Sentinel takes on the job described in the ops strategy. Two
additions, both natural extensions of what the product already does.

### 4a. The conformance rule pack

A rule pack that audits repository *configuration* rather than source. Reports
only — it opens issues, it does not open PRs or change settings. For each repo
in the organisation:

- calls the shared `pr-checks` reusable workflow from `Nano-Collective/.github`
- has the full `test:*` script set (`lint`, `types`, `format`, `ava`, `knip`,
  `audit`, `security`, `all`)
- coverage >= 80% with fail-on-drop enabled
- `CODEOWNERS` exists and names at least two owners
- both org rulesets applied with the expected parameters
- changesets and `release-prepare.yml` present
- `CONTRIBUTING.md`, `LICENSE`, `MAINTAINING.md` present
- no direct collaborator entries — access is team-based only
- live team membership matches the committed `teams.yml`

This is a genuine extension of the rule-pack model: existing packs read source
files, this one reads repository metadata via `gh`. Expect it to need a new
source type alongside `RepoFiles`.

Until this ships, the collective has no drift monitoring — an interim check
rides along with the org-wide stale-escalation cron and retires when this lands.

### 4b. PR review commentary

Sentinel's v1 scope says it files issues and does not comment on pull requests.
The collective needs a PR review agent (`nc-review`), and building a second
Nanocoder-driven review tool alongside Sentinel would be duplication.

The v1.1 extension: allow a rule pack to target an open PR's diff and post a
structured review rather than filing an issue. The rubric is process-focused —
follows `CONTRIBUTING`, changeset present, tests present, duplicates an open PR,
scope crept beyond the linked issue — deliberately excluding anything CI already
checks, since required status checks cover correctness.

**It must never merge.** Labelling (`agent:clean` / `agent:needs-work`) and
commentary only.

## Summary

| Phase | Release | Contents |
|---|---|---|
| **0** | `0.1.0-alpha.4` | Merge PRs #13, #12, #14 → closes #11, #6, #1(partial). Plus #9 docs fix |
| **1** | `0.1.0-alpha.5` | Error surfacing as one change: #4, #5, #7, #8 |
| **2** | `0.1.0-alpha.6` | #2 clone validation, #3 repeatable `--rule-pack` |
| **3** | **`1.0.0`** | Whitepaper published, #10 severity enforcement, #1b incremental scanning + cache schema, release cut |
| **4** | `1.1.0` | Conformance rule pack, PR review commentary |

The critical path runs through phase 1. Everything after it depends on Sentinel
being a tool that tells you when something went wrong.

Phase 3 is the longest phase by a distance — it carries both remaining features
plus the `RunRecord` schema decision. That is a deliberate trade: the schema
becomes expensive to change the moment `1.0.0` ships, so it is settled while
still on alpha.

---

## Open design questions

**Incremental scanning: how is change detected?** (blocks 3c)

Git-diff against the previous run's recorded commit is the simplest and cheapest
approach, but it assumes git history is present — `--no-clone` and local
single-pack mode may hand Sentinel a directory with no `.git`, and `prepareRepo`
clones are shallow (`--depth 1` style), so history depth is not guaranteed
either.

Content hashing per file works regardless of source and degrades gracefully, but
reads every file on every run — which removes some of the saving the feature
exists to deliver, though it still avoids the expensive part (the model calls).

A hybrid — git diff where a usable checkout exists, hashes otherwise — is
probably right, but it means the cache carries two provenance shapes and the
`schemaVersion` field has to accommodate both from day one.

**`severity_weighting` on mismatch: overwrite or reject?** (3b)

Overwrite is recommended above and in the issue. Worth confirming, because the
two behaviours are indistinguishable to a pack author until one fires, and the
choice has to be documented either way.
