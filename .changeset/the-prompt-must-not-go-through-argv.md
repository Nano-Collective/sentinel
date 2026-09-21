---
"@nanocollective/sentinel": patch
---

- **The prompt no longer travels through argv, so audits work on Linux.** The
  entire prompt — pack body plus every matched file — was passed as one
  command-line argument. Linux caps a *single* argv entry at `MAX_ARG_STRLEN`
  (32 pages, 131072 bytes) independently of the much larger `ARG_MAX`, and
  `execve` fails with `E2BIG` before the process starts.

  128 KiB is about 3000 lines, so a pack scoped `src/**/*.ts` exceeds it on
  most real projects — and every production install runs on Linux. Sentinel
  therefore could not audit a repository of ordinary size in the environment it
  ships for, and never had: the first scheduled run to get far enough to try
  returned `spawnSync nanocoder E2BIG` for both packs, at 314 KiB and 218 KiB.
  macOS has no equivalent per-argument cap, which is precisely why every local
  exercise passed.

  The prompt goes through a temporary file now, written outside the audited
  repository and removed on the way out. This needs **Nanocoder 1.31 or newer**;
  the scaffolded workflow pins it, and Sentinel probes for the capability
  before spawning, because an older Nanocoder does not reject the unknown flag
  — it folds it into the prompt and the model is left answering a question made
  of command-line flags.

  `E2BIG` is also handled explicitly now. It should be unreachable, but an
  errno is not an explanation.
