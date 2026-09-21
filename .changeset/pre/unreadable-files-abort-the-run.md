---
"@nanocollective/sentinel": patch
---

- **One unreadable file no longer aborts the whole run.** `walkFiles` guarded
  its `readdirSync` and then called `statSync` on every discovered entry with
  nothing around it, so a dangling symlink, a permission-denied file or a file
  deleted mid-walk threw out of `fsRepoFiles.read`, past the `runFromConfig`
  loop, and out of `cli.ts` — which had no `.catch()` — as an unhandled
  rejection. Because one process audits every target in turn, a single bad file
  in the first repository left every repository after it unaudited, with no run
  record and nothing but a stack trace to say so. Every filesystem call on the
  walk is now guarded, the path is skipped, and the reason is reported. A rule
  pack that cannot be read is recorded as a pack error rather than silently
  dropped, so it shows up where a pack that failed to parse already does. The
  CLI grew a last-resort handler so anything still unexpected exits non-zero
  with its stack, named.
