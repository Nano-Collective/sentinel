## 0.1.0-alpha.4

### Patch Changes

- **A stale or unrelated checkout is no longer audited as if it were current.**
  `prepareRepo` treated any existing directory as a valid checkout, so an empty
  directory, a half-finished clone from an interrupted run, or a checkout of an
  entirely different repository all reported success — and the audit then ran
  against whatever was there and filed findings against the wrong source. It now
  verifies the directory is a git checkout whose `origin` resolves to the repo
  being audited. An empty directory is still cloned into; anything else that
  does not check out is **refused with a reason rather than deleted**, because
  the workspace can hold your own checkouts.
- **`--rule-pack` is genuinely repeatable.** The help text has always presented
  it as the way to choose packs in local mode, while the parser kept a single
  value — so `--rule-pack a.md --rule-pack b.md` silently ran only `b.md`. Every
  occurrence now runs, in the order given, each scoped by its own `applies_to`.
- **Errors are surfaced rather than swallowed.** Four bugs, one failure mode: an
  error was detected, collected, and then quietly dropped. The property this
  restores is that a run which did not complete cannot be mistaken for one that
  found nothing — the failure mode of an auditing tool that swallows errors is a
  green report over a broken estate, which is worse than no tool because it is
  trusted.
  - A **rule pack that fails to parse** is now reported. `packLoadErrors` was
    collected on the run report and read by nothing, so a broken pack was
    silently absent from the audit ([#4]).
  - A pack whose **`depends_on` chain does not resolve** is no longer reported as
    *"not in rule-packs/"*. That was false — the pack is on disk — and it sent
    the reader hunting for a missing file instead of at the dependency error
    ([#5]).
  - **Labels that could not be created** are reported. `ensureLabels` discarded
    the `gh` result entirely, so a run that could not create its labels filed
    issues without them — silently breaking dedup and suppression — and said
    nothing. It stays best-effort; it is no longer silent ([#7]).
  - A **missing or unreadable `sentinel.yaml`** prints a sentence instead of a
    raw `ENOENT` stack trace. This is the first thing anyone hits running
    `sentinel run` outside a configured directory ([#8]).
- **The dashboard no longer renders a broken run as a clean one.** `targetErrors`
  was persisted on every run record and displayed nowhere, so a run in which
  every repository failed to clone showed *"0 finding(s) across 0 repo(s)"* in
  the same calm grey as a genuinely clean estate. There is now a warning banner
  for the latest run and a Problems column across the history.
- **Run records carry pack load failures**, so a finding count of zero can be
  read as "nothing found" or "nothing ran" from the durable artifact alone.
- **Dry runs surface pack problems too.** Every group reading "none" is
  indistinguishable from a clean audit when no pack actually ran.
# 0.1.0-alpha.3

Release plumbing only — no changes to Sentinel itself.

- **`npx @nanocollective/sentinel` installs the newest alpha.** Pre-1.0 releases
  publish under the `alpha` tag and never claimed npm's `latest`, which was
  still pinned to `0.1.0-alpha.0` — so the documented `npx` install fetched the
  first alpha rather than the current one. The release workflow now moves
  `latest` onto each new prerelease until a stable version ships and claims the
  tag itself.
- **Publish detection no longer trusts the `latest` tag.** The version check
  reads the full published-versions list, so a lagging tag can no longer report
  an already-published version as new, and the release notes link to the right
  compare range.

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
