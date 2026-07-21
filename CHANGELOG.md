# 0.1.0

The first published build of Sentinel — an installable, Nanocoder-driven workflow that runs continuous, configurable security and code audits across a GitHub organisation's repositories and files findings as issues.

## What's in this release

- **`sentinel init`** — scaffolds a configuration repo: `sentinel.yaml`, `agents.config.json`, the scheduled GitHub Actions workflow, an empty `rule-packs/` directory, and a disabled starter pack.
- **`sentinel run`** — the audit runtime. Config-driven runs clone each target repo, audit every assigned rule pack through Nanocoder, and file findings as deduplicated, suppressible GitHub issues. A local mode audits a single pack against a repo and writes a Markdown report without filing anything.
- **Rule packs** — the one-file (YAML manifest + Markdown body) format, with dependency resolution and `applies_to` scoping.
- **Findings pipeline** — templated audit prompt, structured-output validation with an auto-fix retry, content-hash dedup, and the three-layer suppression model (dedup floor, per-finding labels, per-repo `sentinel.yaml`).
- **Run modes** — live (files issues) and dry-run (grouped preview: would file as new / dedup would have matched / below severity threshold).

Sentinel ships no rule packs of its own; the installing organisation authors the packs that describe the code it ships.
