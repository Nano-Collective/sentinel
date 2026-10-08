---
"@nanocollective/sentinel": patch
---

- **Dedup no longer keys on prose the model writes.** `findingHash` hashed
  `rule`, `file` and `category`. Its own comment explained that `line_range`
  was excluded because models report slightly different spans for the same
  issue between runs — correct, and equally true of `rule` and `category`,
  which the prompt asks the model to author. The rule suffix worst of all: it
  is invented per run.

  Three live audits of one unchanged file produced `sql/string-concat`,
  `sql/string-concatenation` and `sql/string-concat-user-input`. Each hashed
  differently, so the finding was **refiled as a duplicate and the original
  aged a miss towards being auto-resolved as fixed** — a fresh duplicate every
  morning on a daily schedule, and a real vulnerability closed within the week.
  It survived because the file → match → age → resolve lifecycle had only ever
  run against fakes, where the rule is whatever the fixture says.

  Identity is now the **pack** and the **file**. `pack` is stamped by Sentinel
  after validation and cannot be set by a model — the same distinction
  `withScopeMarkers` already drew when it took the pack from the filing context
  rather than the rule prefix. Two findings from one pack in one file now
  collapse into one issue, which `docs/findings/index.md#dedup` already argues
  is the better outcome.

  Issues filed before this change carry a hash that would never be recomputed,
  but they carry the `pack` and `path` markers the new identity is built from,
  so they are matched on either key and upgrading does not read as every issue
  disappearing at once.
