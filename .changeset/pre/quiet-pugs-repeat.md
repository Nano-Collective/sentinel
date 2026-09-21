---
'@nanocollective/sentinel': patch
---

- **Marker-like text in a finding no longer corrupts the issue body.** Dedup
  state rides in hidden `<!-- sentinel:<key>=... -->` comments appended to each
  filed issue, and marker lookup trusted that an opener found in the body was
  always followed by a close. Issue bodies quote code read from the audited
  repository — `offending_snippet` is explicitly *the exact code* — so a snippet
  containing marker syntax was spliced against as if it were Sentinel's own
  marker.

  Two corruptions followed. An opener with **no close at all** sent the splice
  to a fixed index near the start of the body, pasting most of it back into
  itself: the filed issue arrived with its "Offending code" section, and
  everything after it, duplicated. An opener that **borrowed a later marker's
  close** was worse — a quoted `<!-- sentinel:misses=` sitting above the real
  markers terminated on the `hash` marker's ` -->`, so ageing the miss counter
  deleted every byte between them, taking the trailing body content and the
  real `hash` marker with it. An issue that loses its hash is no longer
  recognised on the next run, so the finding refiles as a duplicate.

  Fixed at both ends, because neither alone covers the other. Marker lookup now
  accepts a candidate only when it is genuinely a marker — a single-line comment
  holding an opaque scalar — and skips quoted openers instead of splicing
  against them, which also repairs issues already filed with one. And marker
  syntax in the four model-authored fields (`summary`, `rationale`,
  `offending_snippet`, `suggested_next_steps`) is neutralised before the body is
  built, so a newly filed issue cannot carry a colliding opener at all.

  That neutralising is a zero-width space, which is the one visible consequence:
  **a body whose text carried marker syntax is no longer byte-identical to the
  pre-fix output**, though it reads identically. Issues already filed keep
  working — their markers are still read and updated in place.

  Closes #40.
