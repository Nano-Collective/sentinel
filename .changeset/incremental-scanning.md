---
"@nanocollective/sentinel": patch
---

- **Incremental scanning.** A target can set `incremental: true` to re-audit
  only the files that changed since its last successful pass, instead of reading
  a whole repository every night. Off by default and opt-in per target: it
  trades a complete re-read for speed, and that is a trade to make on a
  repository you know rather than to inherit.

  This is only safe because auto-resolution now knows what a run read. An open
  issue whose file was skipped is **held** rather than aged towards closing —
  without that, switching this on would auto-close real, unfixed findings after
  three runs.

  Every uncertain case reads everything, because the two mistakes are not the
  same size: being wrong about needing to re-read costs model time, being wrong
  about not needing to costs a missed finding. A pack re-reads in full when
  there is no cached pass, when the pack changed, when a pack it `depends_on`
  changed, when the cached commit is unreachable (a shallow clone, or a
  force-push that orphaned it), or when `--full` is passed.

  "The pack changed" covers its prompt body, `applies_to`, `severity_weighting`
  and `category` as well as its version — deliberately not resting on an author
  remembering to bump. Widening `applies_to` in place would otherwise leave
  every newly-applicable file skipped indefinitely.

  - **A pack whose audit failed records nothing.** Advancing the cache after an
    errored pass would let the next run skip files on the strength of an audit
    that never happened.
  - **The run report, the durable run record and the dashboard all say which
    packs re-read everything, and why**, so a target that opted in and got no
    speed-up explains itself rather than looking broken. The report is a step
    summary that expires; the record is what an operator still has a week later.
  - A repository matching several targets is incremental only if *every* one of
    them opted in, so an unrelated pattern cannot cause a target's files to be
    skipped.
  - The cache is a committed JSON file beside the run records — no database. A
    cache that is missing, unreadable, or written by a newer schema is treated as
    empty, which means a full read.
  - A dry run neither reads nor writes it: a preview must not narrow a later
    audit, nor record a pass it did not make.

  New flags: `--full` to force a complete pass, `--cache-file` to move the cache.
