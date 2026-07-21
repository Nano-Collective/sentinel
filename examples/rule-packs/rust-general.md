---
name: rust-general
version: 0.1.0
description: "Illustrative reliability and safety pack for general Rust code."
applies_to:
  paths: ["src/**/*.rs", "crates/**/*.rs"]
  languages: ["rust"]
severity_weighting:
  unwrap-in-hot-path: medium
  unchecked-unsafe: high
  integer-overflow: medium
  panic-on-external-input: high
depends_on: []
category: correctness
---

# What this pack audits

You are reviewing general Rust code for reliability and memory-safety issues
that a careful reviewer would flag. Report only what the code shown supports.
When a pattern has legitimate exceptions you cannot rule out, lower the
confidence rather than over-asserting.

## Flag these

- **Panic on external input.** `unwrap()`, `expect()`, indexing, or `panic!` on a
  value derived from external input (a request, a file, a CLI arg) that would
  crash the process on malformed input.
- **`unwrap()` / `expect()` in a hot or long-running path.** Even without
  external input, an `unwrap` in a server loop or request handler is a latent
  denial-of-service.
- **Unchecked `unsafe`.** An `unsafe` block whose safety invariant is not
  documented and not obviously upheld (raw pointer deref, `transmute`,
  `from_raw_parts`, uninitialised memory).
- **Integer overflow.** Arithmetic on externally-influenced integers without
  checked/saturating operations where wraparound would be a bug.

## Severity guidance

- Unchecked `unsafe` that could cause UB, or a panic reachable from external
  input: **high**.
- `unwrap`/`expect` in a hot path, or an overflow in a security-relevant
  calculation: **medium**.
- A stylistic `unwrap` in code that is clearly not on a hot path: **low**, lower
  confidence.

## Do not flag

- `unwrap()`/`expect()` in `#[cfg(test)]` modules, `tests/`, examples, and build
  scripts.
- `unsafe` blocks with a clear `// SAFETY:` comment justifying the invariant.
- `expect()` used for genuinely-unreachable invariants during startup with a
  descriptive message.
- Arithmetic on constants or values with proven bounds.
