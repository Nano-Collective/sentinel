---
name: demo-ts-security
version: 0.1.0
description: "Throwaway demo pack for a first real Sentinel run against a TS/JS repo."
applies_to:
  paths: ["**/*.ts"]
  languages: ["typescript", "javascript"]
severity_weighting:
  command-injection: critical
  hardcoded-secret: high
  unsafe-deserialization: high
category: security
---

# What this pack audits

You are reviewing a TypeScript/JavaScript project. This is a demonstration pack.
Flag concrete, defensible issues only — do not invent problems.

## Flag these

- **Command injection.** User- or config-derived data reaching `child_process`
  exec/spawn with a shell, or string-built shell commands.
- **Unsafe deserialization / eval.** `eval`, `new Function`, or `vm` run on
  non-constant input.
- **Path traversal.** A file path built from external input and passed to `fs`
  without normalisation or containment.
- **Hardcoded secrets.** API keys, tokens, or passwords committed as string
  literals (not read from the environment).

## Severity guidance

- Command injection reachable from external input: **critical**.
- A hardcoded live-looking secret: **high**.
- Path traversal without containment: **high**.
- A pattern that is only a smell with no reachable input: **low**, and lower the
  confidence.

## Do not flag

- Uses of `child_process` with a fixed, literal command and no interpolation.
- `eval`/`Function` in test files (`**/*.spec.ts`, `**/*.test.ts`).
- Values clearly read from `process.env`.

When you cannot tell from the code whether external input actually reaches a
sink, file the finding at **low confidence** and say so in the rationale.
