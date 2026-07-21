---
name: example
version: 0.1.0
description: "Illustrative starter pack — demonstrates every manifest field. Not enabled."
applies_to:
  paths: ["src/**/*.ts"]
  languages: ["typescript"]
severity_weighting:
  sql-injection: critical
  unbounded-query: medium
depends_on: []
category: security
---

# What this pack audits

You are reviewing a TypeScript service. This is an illustrative example — replace
it with rules that describe the code your organisation actually ships.

## Flag these

- **SQL injection.** User input reaching a database query without parameterisation.
- **Unbounded query.** A query that can return an entire table with no limit.

## Severity guidance

- SQL injection on a user-facing path: **critical**.
- An unbounded query in a hot path: **medium**.

## Do not flag

- Parameterised queries built with the project's query builder — those are safe.
- Queries in `**/*.spec.ts` test files.
