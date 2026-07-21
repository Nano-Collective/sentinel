---
name: node-server
version: 0.1.0
description: "Illustrative security pack for TypeScript/Node backend services."
applies_to:
  paths: ["src/**/*.ts", "source/**/*.ts", "app/**/*.ts"]
  languages: ["typescript", "javascript"]
severity_weighting:
  sql-injection: critical
  command-injection: critical
  ssrf: high
  path-traversal: high
  unsafe-deserialization: high
  hardcoded-secret: high
  unbounded-query: medium
depends_on: []
category: security
---

# What this pack audits

You are reviewing a TypeScript/Node backend service. Flag issues that are
concrete and defensible from the code shown — do not speculate. When you cannot
tell from the code alone whether external input actually reaches a sink, file
the finding at **low confidence** and say so in the rationale.

## Flag these

- **SQL injection.** User- or request-derived data concatenated or interpolated
  into a SQL string instead of passed as a parameter.
- **Command injection.** External input reaching `child_process` `exec`/`execSync`
  (which use a shell), or any shell command built by string concatenation.
- **SSRF.** A URL built from request input and passed to `fetch`/`axios`/`http`
  without host allow-listing.
- **Path traversal.** A filesystem path built from external input and passed to
  `fs` without normalisation and a containment check.
- **Unsafe deserialization.** `eval`, `new Function`, `vm`, or `JSON.parse` fed
  into a dynamic code path, run on untrusted input.
- **Hardcoded secret.** API keys, tokens, or passwords as string literals rather
  than read from the environment or a secrets manager.
- **Unbounded query.** A database query that can return an entire table or
  collection with no limit, on a request-serving path.

## Severity guidance

- SQL or command injection reachable from a request handler: **critical**.
- SSRF, path traversal, unsafe deserialization, or a live-looking hardcoded
  secret: **high**.
- An unbounded query on a hot path: **medium**.
- A pattern that is only a smell with no reachable external input: **low**, and
  lower the confidence.

## Do not flag

- Parameterised queries built with the project's query builder or an ORM.
- `child_process` calls with a fixed, literal command and no interpolation.
- `eval`/`new Function` in test files (`**/*.spec.ts`, `**/*.test.ts`).
- Values clearly read from `process.env` or an injected config object.
- URLs constructed only from constants.
