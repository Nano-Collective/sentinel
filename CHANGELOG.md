## 0.1.0-alpha.6

### Patch Changes

- **Incremental scanning.** A target can set `incremental: true` to re-audit
  only the files that changed since its last successful pass, instead of reading
  a whole repository every night. Off by default and opt-in per target: it
  trades a complete re-read for speed, and that is a trade to make on a
  repository you know rather than to inherit.

  This is only safe because auto-resolution now knows what a run read. An open
  issue whose file was skipped is **held** rather than aged towards closing —
  without that, switching this on would auto-close real, unfixed findings after
  three runs.

  Every uncertain case reads everything, because the two mistakes are not the
  same size: being wrong about needing to re-read costs model time, being wrong
  about not needing to costs a missed finding. A pack re-reads in full when
  there is no cached pass, when the pack changed, when a pack it `depends_on`
  changed, when the cached commit is unreachable (a shallow clone, or a
  force-push that orphaned it), or when `--full` is passed.

  "The pack changed" covers its prompt body, `applies_to`, `severity_weighting`
  and `category` as well as its version — deliberately not resting on an author
  remembering to bump. Widening `applies_to` in place would otherwise leave
  every newly-applicable file skipped indefinitely.

  - **A pack whose audit failed records nothing.** Advancing the cache after an
    errored pass would let the next run skip files on the strength of an audit
    that never happened.
  - **The run report, the durable run record and the dashboard all say which
    packs re-read everything, and why**, so a target that opted in and got no
    speed-up explains itself rather than looking broken. The report is a step
    summary that expires; the record is what an operator still has a week later.
  - A repository matching several targets is incremental only if *every* one of
    them opted in, so an unrelated pattern cannot cause a target's files to be
    skipped.
  - The cache is a committed JSON file beside the run records — no database. A
    cache that is missing, unreadable, or written by a newer schema is treated as
    empty, which means a full read.
  - A dry run neither reads nor writes it: a preview must not narrow a later
    audit, nor record a pass it did not make.

  New flags: `--full` to force a complete pass, `--cache-file` to move the cache.
- **Auto-resolution now only counts runs that actually looked.** Reconciliation
  could not distinguish *the finding is gone* from *the file was not read* —
  both arrive at the planner as an absent finding, and both bumped the miss
  counter until the issue was closed as fixed. That is harmless while every run
  reads every file and catastrophic the moment one does not: it is the shape of
  an audit tool reporting a vulnerability as fixed because it stopped looking.

  A run now carries the scope it read, and an open issue whose file was not read
  is **held** — neither refreshed nor aged, its miss counter left exactly where
  it was. Holding is recoverable; auto-closing a real finding is not.

  - **Scope is per rule pack, not per repository.** Packs do not read the same
    files, so a repo-wide scope would call a file "scanned" for a pack that
    never opened it and reintroduce the bug for anything running more than one
    pack.
  - Filed issues carry `pack` and `path` markers. The file was previously only
    prose in the body, and the pack was not recorded at all — parsing either
    back out would have broken the first time the template changed.
  - **Held issues are reported**, separately from aged ones, in the run summary,
    the dry-run preview, the run record and the dashboard. `aged` means Sentinel
    looked and did not find; `held` means it did not look, and collapsing the
    two would hide the distinction this exists to draw.

  Behaviour is unchanged today: every run still reads every file, so every scope
  is complete and nothing is ever held. This lands first so that incremental
  scanning cannot be added without it.
## 0.1.0-alpha.5

### Patch Changes

- **`severity_weighting` is now enforced, not merely suggested.** The manifest
  field was parsed, put in front of the model, and then never checked against
  what came back — so a pack declaring `sql-injection: critical` could have the
  model answer `low` and that severity would be filed. The pack's value now wins,
  in both directions: a model inflating everything to `critical` is as much a
  triage problem as one understating. Rules a pack does not list keep the
  model's severity, so weighting stays opt-in per rule.
  - Keys resolve whether written bare (`sql-injection`) or fully qualified
    (`db-safety/sql-injection`), because findings are reported as
    `<pack>/<pattern>` and a literal lookup would have matched nothing.
  - **Overrides are reported in the run summary** — which rule, in which file,
    and from what to what. A pack author calibrating a weighting needs to see it
    firing, and an operator reading a `critical` needs to know whether the model
    or the pack said so.

  Overwriting rather than rejecting on mismatch is deliberate: a finding can be
  entirely accurate and still carry a guessed severity, and failing validation
  would discard real work to re-derive an answer already in the manifest.
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
