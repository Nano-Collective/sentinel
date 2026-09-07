# Sentinel Roadmap

Current version: **`0.1.0-alpha.4`** · five prereleases cut · 97% coverage

Last reconciled against the repository on **2026-09-07**.

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
| Open PRs | 0 |
| Open issues | **0.** |
| Releases cut | **6**, all prereleases; latest `0.1.0-alpha.5` |
| Coverage | ~97.6% |

**Phases 0, 1, 2 and 3 are all merged.** The whitepaper is published, #10
(severity enforcement) shipped in `0.1.0-alpha.5`, and #17 landed as two PRs:
**#34** made auto-resolution aware of what a run actually read, and **#36** added
the incremental cache on top of it. #1 is closed as superseded — both its halves
now exist.

**The only thing between here and `1.0.0` is cutting the release.**

One thing to know before doing that, verified rather than assumed: on today's
`main`, `changeset pre exit` followed by `changeset version` produces **`0.1.0`,
not `1.0.0`** — every changeset in the alpha series is a `patch`. Shipping
`1.0.0` needs a deliberate `major` changeset. Exiting pre mode does correctly
roll every alpha entry into one consolidated `0.1.0` changelog section; nothing
is lost.

*Correction:* earlier versions of this document said no GitHub release had been
cut and put the count at zero. That was wrong when written — `v0.1.0-alpha.0`
through `alpha.3` were all published between 21 and 26 July 2026. The claim it
was presumably reaching for is that no **stable** release exists, which remains
true and is what phase 3 is for.

Two issues raised after this roadmap was first written are placed below: **#16**
(the type gate never typechecked specs — fixed in #21) and **#17** (incremental
scanning and the auto-resolution fix it requires, which supersedes the sketch in
3c). Both are now closed.

### Releasing — read this before cutting anything

Release plumbing is in place: `release.yml` triggers on push to `main` and
publishes when `package.json`'s version is ahead of npm, moving the `latest` tag
onto each prerelease until a stable version claims it (that was the whole content
of `alpha.3`).

Since #19 the version bump goes through **changesets**, not a hand edit: each PR
carries a changeset, `release-prepare.yml` accumulates them into a Version
Packages PR, and merging that PR pushes the bump `release.yml` publishes.

**#20 was a prerequisite for any of that, and the trap was real.** Changesets
was adopted without entering pre mode, so `changeset version` resolved
`0.1.0-alpha.3` to **`0.1.0`** — the first Version PR merged would have shipped
v1, claimed npm's `latest`, and skipped everything below in one merge.

**Confirmed in production:** with `.changeset/pre.json` in place, the Version PR
generated once #22 landed bumped to `0.1.0-alpha.4`, and the release published
as `0.1.0-alpha.4` with both dist-tags moved onto it. Without #20 that same PR
would have read `1.0.0`.

Consequently **cutting `1.0.0` is a deliberate two-step** — `changeset pre exit`
then `changeset version` — and doing it early releases v1 by accident. See
`.changeset/README.md`.

---

## Phase 0 — Merge what is already open → `0.1.0-alpha.4` ✅ merged

Every open PR closed an open issue. This was the cheapest progress available and
it took the backlog from 11 issues to 8.

**All three are merged**, and shipped in `0.1.0-alpha.4` on 2026-09-07 — though
alongside phases 1 and 2 rather than as a release of their own.

| PR | Closes | Substance |
|---|---|---|
| **#12** surface aged / suppressed / override counts in the run summary | **#11** | `ReconcileResult` already carried `incremented`, `suppressed` and `suppressedByOverride`; the CLI and the persisted run record dropped them, so a pack author calibrating suppressions could not tell whether `sentinel:false-positive` markers were doing anything |
| **#13** reject non-integer and out-of-range line numbers | **#6** | `validateLineRange` gated on `typeof === 'number'`, letting `Infinity`, `NaN` and fractional values through — `start < 1 \|\| end < start` is false for all of them, so a hallucinated `line_range` validated cleanly |
| **#14** `sentinel estimate` + per-run model instrumentation | **#1** (partial) | Enhancement 1 of #1. Incremental scanning (enhancement 2) is deliberately excluded — it needs schema sign-off on the cache |

**Order taken:** #13 first (a correctness fix in the findings path the other two
do not touch), then #12, then #14.

**#9 is closed.** The stale header comment claiming `sentinel run` was
unimplemented was rewritten by #14 when it added `sentinel estimate`, so no
separate change was needed.

---

## Phase 1 — The error-surfacing class ✅ merged (#22), shipped in `alpha.4`

**This is the most important work in the roadmap.** Four of the seven open bugs
are the same failure mode: an error is detected, collected, and then silently
discarded. Fix them as one change, not four.

**Written as #22**, which also fixes two further instances of the same class
found while doing it — both worth recording, because they are the ones that
would have kept the property untrue:

- **The dashboard rendered `targetErrors` nowhere.** The field was persisted on
  every run record and displayed on no surface, so a run in which every
  repository failed to clone showed *"0 finding(s) across 0 repo(s)"* in the
  same calm grey as a clean estate. This is the purest form of the green-report
  failure below, on the surface an operator actually looks at.
- **`RunRecord` did not carry pack load failures**, so the durable artifact
  could not distinguish "nothing found" from "nothing ran" once the console
  output was gone.

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

**Shipped in `0.1.0-alpha.4`**, described in the changelog as a class of fix
rather than four bullets: errors are now surfaced rather than swallowed. The
separate `alpha.5` this section originally planned was folded in — see the
summary table.

---

## Phase 2 — Remaining correctness ✅ merged (#23), shipped in `alpha.4`

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

*Note:* `clone.ts` sits inside a `/* c8 ignore */` block, so the coverage figure
does not cover this file. Whatever fix lands here needs tests that actually run.

*Resolved in #23:* the decision logic is extracted into `inspectCheckout` behind
an injected probe, leaving only the `gh` spawn and the real filesystem reads
ignored. The refusal is deliberately non-destructive — an unusable directory is
reported, never deleted, because the workspace can hold the operator's own
checkouts.

### #3 — `--rule-pack` documented as repeatable but only one is read

`source/cli.ts:218` reads `flagStr(flags, 'rule-pack')` — a single value —
while the help text at `:130` presents it as the mechanism for choosing packs in
local mode.

*Fix:* collect repeated occurrences into an array and run all of them, or
correct the documentation. Prefer the former; running two packs locally is a
reasonable thing to want.

### #16 — the type gate never typechecked specs ✅ merged (#21)

Raised after this roadmap was written, and placed here because it protects
everything in phase 3: `tsconfig.json` excludes `source/**/*.spec.ts` so that
`tsc && tsc-alias` keeps specs out of `dist/`, and `test:types` ran that same
config — so the gate never looked at a single spec file. Specs are usually the
first place a contract change shows up, and phase 3 changes contracts.

Fixed by a `tsconfig.test.json` that drops only the exclude, with `test:types`
running both configs. Adding a required field to an exported interface passes
the old gate with 0 errors and fails the new one with 10.

**Shipped in `0.1.0-alpha.4`.** This section offered the option of rolling the
phase into a later release since only two items remained; in the event both
landed alongside phase 1, so the planned `alpha.6` was never cut either.

---

## Phase 3 — v1

All 7 bugs and all 3 PRs are done. Four things stand between that and `1.0.0`.

### 3a. Publish the whitepaper ✅ done

`README.md:9` and `docs/index.md:47` both state that this repository
"describe[s] the v1 design settled in the [Sentinel whitepaper]" and link to
`https://docs.nanocollective.org/collective/whitepapers/sentinel`.

**Published 2026-09-07** at that URL, status `Building`, no review window.
`review_opens` and `review_closes` are **omitted rather than back-filled** —
`buildReviewText` returns null when both are absent, so the badge shows the
status alone and no invented review window is recorded. The paper states in its
own opening why it is retrospective, so a reader is not left wondering why a
shipped project is being proposed.

The rest of this section is the reasoning that led there, kept for the record.

**That URL returned 404.** There is no `sentinel.md` in the docs repo's
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

### 3b. #10 — Enforce `severity_weighting` ✅ merged (#30)

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

**Shipped as overwrite, in both directions** — a model inflating everything to
critical is as much a triage problem as one understating, so a *lower* manifest
value wins too. Two things worth carrying forward:

- **Key resolution was the part that decided whether it worked at all.**
  Findings are reported as `<pack>/<pattern>` while manifests are written with
  bare pattern names, so a literal lookup matches nothing in the common case —
  exactly how this feature could have shipped and still done nothing. Both
  spellings resolve, fully-qualified winning where both exist.
- **Overrides are reported, not applied silently.** The run report names the
  rule, the file, and the change. Same property alpha.4 established for errors:
  a thing that changes the output must not be invisible.

Documented in `docs/rule-packs/index.md` as authoritative rather than advisory.

### 3c. #1 (second half) — Incremental scanning ✅ shipped

**Shipped as two PRs, deliberately split.** #17 asked for the auto-resolution
fix and the cache in one change; the risk it guarded against was a cache landing
*without* the fix, and doing the fix first inverts that and carries none of it.

- **#34 — scope-aware reconciliation.** A run carries what it read; an open
  issue whose file was not read is *held*, its miss counter untouched. No
  behavioural change on its own, because every run still read everything.
- **#36 — the cache.** `incremental: true` per target, off by default.

**Two decisions differ from what this section proposed, both deliberate.**

**The cache is a separate artifact, not an extension of `RunRecord`.** This
section preferred folding it in, on the grounds that a second store invites
drift. The two turned out to want opposite shapes: `RunRecord` is append-only
history, one file per run, while the cache is *current state* — a single file,
overwritten. Reconstructing "what did pack X last complete on repo Y" from an
append-only log means scanning and merging records while skipping the dry runs
and the failed passes, and a dry run writes a record but must not write cache
state. Two artifacts with different lifecycles are cheaper than one with two
lifecycles. The cache carries its own `version` field, and an unrecognised
version is discarded rather than trusted.

**`RunRecord` still has no `schemaVersion`, and should get one.** That
recommendation was tied to `RunRecord` becoming the cache, so it did not land
here — but the underlying point stands on its own: the dashboard reads every
historical record back, and this release added two more optional fields to it
(`filing.held`, `repos[].fullPasses`). Those are additive and safely absent, but
the reader is still distinguishing record shapes by which keys happen to exist.
**Worth doing before `1.0.0`** for the reason below — it is free on alpha and a
migration afterwards.

What follows is the original reasoning, kept for the record.

**#17 adds a blocker this section did not see, and it is the important part.**
Incremental scanning breaks auto-resolution: `planReconciliation` sees only this
run's findings and the currently open issues, so it cannot distinguish "the
finding is gone" from "the file was never scanned". Any hash absent from a run
bumps the miss counter, and at `resolveAfterMisses` the issue closes. On a daily
schedule, skipping unchanged files therefore **silently closes real, unfixed
findings after three runs** — the tool quietly reporting a vulnerability as fixed
because it stopped looking. The scanned scope has to reach the planner so an
out-of-scope issue is *held* rather than aged out, and that has to land in the
same change as the cache, not after it.

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

| Phase | Release | Contents | State |
|---|---|---|---|
| **0** | `0.1.0-alpha.4` | PRs #13, #12, #14 → closed #11, #6, #1(partial). #9 closed as already fixed | ✅ merged |
| **1** | shipped in `alpha.4` | Error surfacing as one change: #4, #5, #7, #8 | ✅ #22 |
| **2** | shipped in `alpha.4` | #2 clone validation, #3 repeatable `--rule-pack`, #16 type gate | ✅ #23, #21 |
| **3** | **`1.0.0`** | ✅ whitepaper published · ✅ #10 severity enforcement (#30) · ✅ #17 held-issue fix (#34) + incremental cache (#36) · ⬜ `RunRecord.schemaVersion` · ⬜ release cut | 🔶 |
| **4** | `1.1.0` | Conformance rule pack, PR review commentary | ⬜ |

Phases 1 and 2 were folded into a single release rather than the separate
`alpha.5` and `alpha.6` originally planned: both were ready together, and one
release carrying a coherent story — errors are surfaced, checkouts are verified —
reads better in a changelog than two thin ones.

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

*Narrowed by #23:* "a usable checkout" is no longer a guess. `inspectCheckout`
now establishes that a workspace directory is a git checkout of the right
repository before anything is audited, so the git-diff branch of the hybrid has
a defined precondition to test rather than an assumption to make.

**How does a held issue avoid being aged out?** ✅ *settled in #34*

Filed issues carry `pack` and `path` markers. **Both**, not just `path` as #17
proposed: scope has to be tracked per pack, because packs do not read the same
files, and a repo-wide scope would call a file "scanned" for a pack that never
opened it.

**The migration answer changed, and the reason is worth keeping.** #17 suggested
treating an unmarked issue as always in scope, since "the marker backfills
naturally as issues are touched". That has a hole: **an issue is only touched
when its finding recurs, which requires its file to be read.** With incremental
scanning on, an issue in an unchanged file is never touched, never backfills,
and ages out in three runs — the issues the migration leaves behind are exactly
the ones at risk.

So the unmarked case splits by run type: **scanned** on a complete run (which is
byte-identical to the old behaviour, and what made #34 a no-op), **held** on a
partial one. The "held forever" worry that motivated the original suggestion is
bounded by an invariant: the cache cannot exist on the first run, so that run
reads everything and marks every issue that survives it before any file is ever
skipped.

**How does incremental scanning detect change?** ✅ *settled in #36*

Git diff against the recorded commit, with **no** content-hashing fallback. The
hybrid this section reached for was not needed: every branch that cannot produce
a trustworthy diff reads everything instead, which is both simpler and the safe
direction. `changedSince` returns `null` for an unreachable commit — a shallow
clone, or a force-push that orphaned it — and *cannot tell* is never allowed to
collapse into *nothing changed*. The cache therefore carries one provenance
shape, not two.

**`severity_weighting` on mismatch: overwrite or reject?** ✅ *settled in #30*

Shipped as overwrite, in both directions. A finding can be entirely accurate and
still carry a guessed severity, so rejecting would discard real work to re-derive
an answer the manifest already holds. Documented in `docs/rule-packs/index.md`.
