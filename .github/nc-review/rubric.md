# nc-review rubric — Sentinel

This is the **project** half of the rubric: what Sentinel cares about. The
reviewing method — how to read a diff against a base checkout, how to rate
severity, what to emit — is the shared base rubric you were also given. Read
both; where they disagree, this file wins.

## What this project is, and why that changes review

Sentinel audits other people's repositories and files what it finds as issues.
It is a tool whose entire output is a claim about someone else's code.

That gives it one failure mode worse than all the others: **a green report over
a broken estate.** If Sentinel silently fails to scan something, or swallows an
error, or reports success it has not earned, the operator concludes their
repositories are clean when nobody looked. That is worse than having no tool,
because a tool gets trusted.

So weigh findings by whether they can make Sentinel **quietly wrong**:

- **Silently discarding an error is `blocking`.** Collecting one and never
  rendering it counts as discarding it. Four bugs of exactly this shape shipped
  here and were fixed together in the alpha.4 release; do not let a fifth in.
- **Reporting a state the run did not establish is `blocking`** — treating an
  unverified checkout as current, counting a skipped pack as clean, closing an
  issue for a file that was never scanned.
- A crash is `important`. Loud failure is safe failure in an auditing tool.

Before accepting any new error path, ask the question that catches this class:
**where does this error surface?** If the answer is "it is returned" or "it is
collected", follow it to the thing a human actually reads — the run report, the
CLI summary, the run record, the dashboard. If it does not reach one of those,
it is discarded.

## Where the bugs actually are

### Errors collected but never rendered

The recurring bug. A field exists on a result type, is populated, and nothing
reads it. `packLoadErrors` lived on the run report unread; `targetErrors` was
persisted to every run record and displayed on no surface, so a run in which
every repository failed to clone rendered as *"0 findings across 0 repos"* in
the same calm grey as a clean estate.

New surfaces make this easy to reintroduce: add a field to `RunRecord` without
touching the dashboard and you have rebuilt it exactly.

### Conflating distinct failures

A pack that is **missing from disk** and a pack that is **present but whose
`depends_on` chain will not resolve** are different problems with different
fixes. They were reported identically, which sent readers hunting for a file
that was already there. Watch for a diff that funnels two causes into one
message or one list.

### Auto-resolution closing live findings

`planReconciliation` decides when an issue has gone away, and it can only see
this run's findings and the currently open issues. Anything that changes **what
gets scanned** — incremental scanning, path filters, a pack that silently does
not run — can make a real finding look absent and age it out to closed. This is
the tool telling a maintainer a vulnerability is fixed because it stopped
looking. Treat any change near scanned scope or the miss counter as
security-relevant.

### Trusting the workspace

A directory that exists is not a checkout of the right repository. Findings
produced against stale or unrelated source, filed against the named repo, are
confidently wrong in the most expensive way.

### Model output is untrusted input

Findings come from an LLM. Line ranges, severities and rule names are all
attacker-adjacent and hallucination-adjacent. Validation is not a formality —
`Infinity`, `NaN` and fractional line numbers all passed the original range
check. A change that loosens validation, or adds a field that skips it, is a
finding.

## Public contracts

Breaking these is `blocking` without a changeset and a deliberate bump:

- **`RunRecord`** — durable, committed per run, and read back by the dashboard
  across versions. It has no `schemaVersion` yet; adding fields must stay
  backward-compatible, and an absent field is not the same as an empty one.
- **The rule pack manifest format** and `sentinel.yaml`'s schema. Third-party
  packs and existing installs depend on both.
- **The findings data model** and anything exported from `source/index.ts`.
- **Issue body markers** (`hash`, `misses`, `last-seen`) — dedup reads these
  back from issues filed by older versions. Changing the hash inputs refiles
  everything as new.
- CLI flags and their semantics.

`CONTRIBUTING.md` says to treat these as breaking until proven otherwise.

## Tests

Tests are colocated as `source/**/*.spec.ts`. Ava excludes `*-helpers.ts` and
`test-helpers.ts`, so shared fixtures belong in those.

`test:types` typechecks the specs as well as the build — a spec constructing an
exported type incorrectly is a real type error here, not a warning. If a diff
adds a required field to an exported interface, the fixtures that construct it
must be updated in the same change.

`clone.ts` and `gh-client.ts` hold `/* c8 ignore */` blocks around the parts
that spawn processes. Logic put inside those blocks is invisible to coverage,
so a decision that matters belongs outside them behind an injected seam. Flag a
change that buries real logic in an ignored block.

## Rule packs

Sentinel ships **no** general-purpose rule packs as product, deliberately. A PR
adding one is out of scope and `CONTRIBUTING.md` says so; the clearly
illustrative examples are the exception. Say it kindly — it is a reasonable
mistake to make.

## Scope and direction

`ROADMAP.md` carries the plan and the open design questions. A change that
settles one of those — the cache schema, `severity_weighting` on mismatch —
should say so rather than deciding it silently in passing.
