---
"@nanocollective/sentinel": patch
---

- **Auto-resolution now only counts runs that actually looked.** Reconciliation
  could not distinguish *the finding is gone* from *the file was not read* —
  both arrive at the planner as an absent finding, and both bumped the miss
  counter until the issue was closed as fixed. That is harmless while every run
  reads every file and catastrophic the moment one does not: it is the shape of
  an audit tool reporting a vulnerability as fixed because it stopped looking.

  A run now carries the scope it read, and an open issue whose file was not read
  is **held** — neither refreshed nor aged, its miss counter left exactly where
  it was. Holding is recoverable; auto-closing a real finding is not.

  - **Scope is per rule pack, not per repository.** Packs do not read the same
    files, so a repo-wide scope would call a file "scanned" for a pack that
    never opened it and reintroduce the bug for anything running more than one
    pack.
  - Filed issues carry `pack` and `path` markers. The file was previously only
    prose in the body, and the pack was not recorded at all — parsing either
    back out would have broken the first time the template changed.
  - **Held issues are reported**, separately from aged ones, in the run summary,
    the dry-run preview, the run record and the dashboard. `aged` means Sentinel
    looked and did not find; `held` means it did not look, and collapsing the
    two would hide the distinction this exists to draw.

  Behaviour is unchanged today: every run still reads every file, so every scope
  is complete and nothing is ever held. This lands first so that incremental
  scanning cannot be added without it.
