# 0.1.0-alpha.2

Fixes from running the full audit loop live against a real repository. Several
of these affect correctness — an alpha.1 install has broken dedup and cannot
file on a fresh repo.

- **Dedup no longer refiles duplicates.** The content hash included the line
  range, which LLMs report inconsistently between runs, so the same finding got
  a new hash and was refiled. Identity is now `rule + file + category`, which
  stays stable across runs.
- **Filing works on a fresh repo.** Sentinel now creates its own labels
  (`sentinel` and the suppression labels) before filing, instead of crashing
  when `gh issue create --label` hits a label GitHub does not know about.
- **A single filing failure no longer aborts the run.** Each create/update/close
  is tolerated and reported; the batch continues.
- **Dry-run no longer hides audit failures.** A pack that fails validation is
  surfaced in the preview instead of reading as "clean".
- **Truncated model output is salvaged.** When a run is cut off mid-array, the
  leading complete findings are recovered rather than discarded.
- **New `--resolve-after-misses` flag** to tune auto-resolution.

# 0.1.0-alpha.1

Rounds out the v1 surface on top of the first alpha.

- **Org pattern targets.** `pattern: "org/*"` now enumerates the owner's
  repositories (via `gh`) and audits the matches, merging rule packs when a repo
  matches several targets — no more hand-listing every repo.
- **Run records + dashboard.** Each run commits a JSON record to `runs/` and
  regenerates a self-contained static `dashboard/index.html` (GitHub Pages
  ready) — the read-side history, no database.
- **Example rule packs.** Three illustrative, CI-validated packs
  (`node-server`, `rust-general`, `solana-anchor`) under `examples/rule-packs/`.
- **From-template install.** A committed `template/` directory (kept in sync
  with the scaffolder) for the npx-free `degit` / "Use this template" path.
- **Hardening.** npm publish provenance, issue/PR templates, `SECURITY.md`,
  CODEOWNERS.

# 0.1.0-alpha.0

The first published (prerelease) build of Sentinel — an installable, Nanocoder-driven workflow that runs continuous, configurable security and code audits across a GitHub organisation's repositories and files findings as issues.

## What's in this release

- **`sentinel init`** — scaffolds a configuration repo: `sentinel.yaml`, `agents.config.json`, the scheduled GitHub Actions workflow, an empty `rule-packs/` directory, and a disabled starter pack.
- **`sentinel run`** — the audit runtime. Config-driven runs clone each target repo, audit every assigned rule pack through Nanocoder, and file findings as deduplicated, suppressible GitHub issues. A local mode audits a single pack against a repo and writes a Markdown report without filing anything.
- **Rule packs** — the one-file (YAML manifest + Markdown body) format, with dependency resolution and `applies_to` scoping.
- **Findings pipeline** — templated audit prompt, structured-output validation with an auto-fix retry, content-hash dedup, and the three-layer suppression model (dedup floor, per-finding labels, per-repo `sentinel.yaml`).
- **Run modes** — live (files issues) and dry-run (grouped preview: would file as new / dedup would have matched / below severity threshold).

Sentinel ships no rule packs of its own; the installing organisation authors the packs that describe the code it ships.
