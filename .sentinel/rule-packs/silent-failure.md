---
name: silent-failure
version: 1.0.0
description: "Sentinel's signature failure class — a result that reports success, or nothing, when the work did not actually happen."
applies_to:
  # Scoped to the modules where work can silently not happen — the run loop,
  # the model orchestration, the incremental cache and the durable record.
  #
  # Not `source/**/*.ts`: that is ~174k tokens against a 131k context, because
  # `applies_to.paths` has no way to exclude a path and Sentinel's tests sit
  # beside its source. The whole prompt is spent carrying files this pack's
  # "do not flag" section then tells the model to ignore. See #48.
  paths:
    - "source/run/**/*.ts"
    - "source/orchestrator/**/*.ts"
    - "source/incremental/**/*.ts"
    - "source/observe/**/*.ts"
  languages: ["typescript"]
severity_weighting:
  swallowed-error: high
  absent-vs-empty: high
  unguarded-io: high
  success-without-work: critical
depends_on: []
category: correctness
---

# What this pack audits

You are reviewing Sentinel, a TypeScript CLI that audits other people's
repositories on a schedule and files what it finds as GitHub issues. Operators
do not watch it run. They read a green tick, a finding count, and a committed
run record.

That shapes what counts as a serious bug here. **The dangerous failure in this
codebase is not a crash — it is a clean-looking result produced by work that did
not happen.** A crash gets noticed the same morning. A run that reports "no
findings" because the model was unreachable, or because a file was never read,
gets believed.

Every bug this pack looks for has the same shape: a path where *absent* and
*empty*, or *did not run* and *found nothing*, become indistinguishable to
whoever reads the output.

## Flag these

- **`success-without-work`.** A function returns a success value, an empty
  collection, or a zero count on a path where the work was skipped or failed.
  The clearest tell is an error that is caught and turned into an empty result
  that a caller cannot distinguish from a genuine empty result. Also flag a
  non-zero count or an `ok: true` that is reachable without the operation having
  completed.

- **`swallowed-error`.** A `catch` block that discards the error — empty body,
  `continue`, `return null`, `return []`, or a bare default — without recording
  it anywhere a human will see: a returned error field, a collected problem
  list, `console.error`, or a rethrow. An error written only to a variable
  nothing reads counts as swallowed.

  Not every discard is a bug. It is fine when the caller genuinely cannot act on
  it *and* the surrounding code says so in a comment explaining the reasoning.
  Flag the ones with no such reasoning.

- **`unguarded-io`.** A synchronous filesystem, `spawn`, or `JSON.parse` call
  whose failure is not handled on a path that processes many items in one
  process. Sentinel audits every configured repository in a single run, so an
  unguarded throw partway through does not fail one item — it abandons every
  item after it. Pay attention to calls inside loops, and to calls made on paths
  discovered from a repository Sentinel did not write.

- **`absent-vs-empty`.** A durable, committed artifact — a run record, the
  incremental cache, an issue body marker — read back in a way that cannot tell
  "this field was never written" from "this field was written as zero/empty".
  These files outlive the version that wrote them, so a reader that guesses will
  be wrong about old data forever. Flag optional fields defaulted to a value
  that erases the distinction (`?? 0`, `?? []`) where the distinction matters to
  what the reader concludes.

## Severity guidance

- A path where an operator reads **"clean" and the audit did not run**:
  **critical**. This is the worst outcome the tool has.
- A swallowed error or unguarded I/O call that **abandons remaining work**:
  **high**.
- An absent/empty confusion in a **committed artifact**: **high** — it is a
  migration once a stable version ships.
- The same confusion in an in-memory value that one caller consumes
  immediately: **medium**.

## Do not flag

- `catch` blocks that record the failure somewhere a human reads — a collected
  error list, a `runError` field on an outcome, `console.error`, a rethrow.
  Recording it *is* the fix; that code is already correct.
- Deliberate "treat unreadable as empty" behaviour where the comment explains
  that the empty direction is the safe one and why. Sentinel does this on
  purpose for the incremental cache: an unreadable cache means read everything,
  which is complete rather than partial. That reasoning is sound, and code
  carrying it is not a finding.
- Test files (`*.spec.ts`) and test helpers. A test that swallows an error is a
  weak test, not a production failure.
- Missing `await` or unhandled promises that TypeScript's own checks would
  catch — the build already enforces that, and repeating it here is noise.
- Style, naming, formatting, or anything Biome enforces.
