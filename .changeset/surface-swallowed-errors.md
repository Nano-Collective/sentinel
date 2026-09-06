---
"@nanocollective/sentinel": patch
---

- **Errors are surfaced rather than swallowed.** Four bugs, one failure mode: an
  error was detected, collected, and then quietly dropped. The property this
  restores is that a run which did not complete cannot be mistaken for one that
  found nothing — the failure mode of an auditing tool that swallows errors is a
  green report over a broken estate, which is worse than no tool because it is
  trusted.
  - A **rule pack that fails to parse** is now reported. `packLoadErrors` was
    collected on the run report and read by nothing, so a broken pack was
    silently absent from the audit ([#4]).
  - A pack whose **`depends_on` chain does not resolve** is no longer reported as
    *"not in rule-packs/"*. That was false — the pack is on disk — and it sent
    the reader hunting for a missing file instead of at the dependency error
    ([#5]).
  - **Labels that could not be created** are reported. `ensureLabels` discarded
    the `gh` result entirely, so a run that could not create its labels filed
    issues without them — silently breaking dedup and suppression — and said
    nothing. It stays best-effort; it is no longer silent ([#7]).
  - A **missing or unreadable `sentinel.yaml`** prints a sentence instead of a
    raw `ENOENT` stack trace. This is the first thing anyone hits running
    `sentinel run` outside a configured directory ([#8]).
- **The dashboard no longer renders a broken run as a clean one.** `targetErrors`
  was persisted on every run record and displayed nowhere, so a run in which
  every repository failed to clone showed *"0 finding(s) across 0 repo(s)"* in
  the same calm grey as a genuinely clean estate. There is now a warning banner
  for the latest run and a Problems column across the history.
- **Run records carry pack load failures**, so a finding count of zero can be
  read as "nothing found" or "nothing ran" from the durable artifact alone.
- **Dry runs surface pack problems too.** Every group reading "none" is
  indistinguishable from a clean audit when no pack actually ran.
