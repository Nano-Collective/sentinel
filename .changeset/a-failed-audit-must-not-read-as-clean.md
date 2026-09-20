---
"@nanocollective/sentinel": patch
---

- **A failed audit no longer reports as a clean one.** Found by running the
  scaffolded install against a deliberately unreachable model: Sentinel printed
  `0 finding(s) across 1 repository(ies)`, exited `0`, and committed a run
  record showing nothing. The per-pack reason was in the report body, but the
  headline, the exit code and the durable record all said clean — so a
  scheduled audit whose model was misconfigured or down would have gone green
  every morning while auditing nothing.

  A pack that reached the model and came back with nothing usable is now a
  run-level problem, alongside packs that failed to load and targets that could
  not be checked out. It appears in the **⚠️ Problems** section of the report on
  every path rather than only in a dry run's preview, is named on stderr, and
  makes the run exit non-zero so the workflow goes red.

  A pack that ran and found nothing is untouched — that is a clean result and
  still reads as one. The two states this separates are *nothing was found* and
  *nothing was looked at*.
