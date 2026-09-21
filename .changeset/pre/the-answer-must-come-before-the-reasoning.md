---
"@nanocollective/sentinel": patch
---

- **The output contract now bounds what comes *before* the findings array, not
  just after it.** It said "write nothing after that line" and nothing at all
  about the other direction — so a model that narrated its way through the
  files for thousands of tokens and then opened the fence was following the
  contract exactly, right up until the output ceiling cut it off mid-sentence.
  Sentinel then reported malformed output for an audit that had, in fact, been
  done well.

  Found on the first real run of Sentinel's own self-audit: the model correctly
  identified that `gh` legitimately needs the token it is given, that the model
  subprocess now receives a scoped allowlist, and that the dedup markers defend
  themselves against quoted openers — and never reached the array. Adding one
  instruction not to narrate turned the same pack, same model and same files
  from `malformed output after 2 attempt(s)` into a clean pass.
