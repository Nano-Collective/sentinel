---
"@nanocollective/sentinel": patch
---

- **A stale or unrelated checkout is no longer audited as if it were current.**
  `prepareRepo` treated any existing directory as a valid checkout, so an empty
  directory, a half-finished clone from an interrupted run, or a checkout of an
  entirely different repository all reported success — and the audit then ran
  against whatever was there and filed findings against the wrong source. It now
  verifies the directory is a git checkout whose `origin` resolves to the repo
  being audited. An empty directory is still cloned into; anything else that
  does not check out is **refused with a reason rather than deleted**, because
  the workspace can hold your own checkouts.
- **`--rule-pack` is genuinely repeatable.** The help text has always presented
  it as the way to choose packs in local mode, while the parser kept a single
  value — so `--rule-pack a.md --rule-pack b.md` silently ran only `b.md`. Every
  occurrence now runs, in the order given, each scoped by its own `applies_to`.
