## 0.1.0-alpha.8

### Patch Changes

- **Dedup no longer keys on prose the model writes.** `findingHash` hashed
  `rule`, `file` and `category`. Its own comment explained that `line_range`
  was excluded because models report slightly different spans for the same
  issue between runs — correct, and equally true of `rule` and `category`,
  which the prompt asks the model to author. The rule suffix worst of all: it
  is invented per run.

  Three live audits of one unchanged file produced `sql/string-concat`,
  `sql/string-concatenation` and `sql/string-concat-user-input`. Each hashed
  differently, so the finding was **refiled as a duplicate and the original
  aged a miss towards being auto-resolved as fixed** — a fresh duplicate every
  morning on a daily schedule, and a real vulnerability closed within the week.
  It survived because the file → match → age → resolve lifecycle had only ever
  run against fakes, where the rule is whatever the fixture says.

  Identity is now the **pack** and the **file**. `pack` is stamped by Sentinel
  after validation and cannot be set by a model — the same distinction
  `withScopeMarkers` already drew when it took the pack from the filing context
  rather than the rule prefix. Two findings from one pack in one file now
  collapse into one issue, which `docs/findings/index.md#dedup` already argues
  is the better outcome.

  Issues filed before this change carry a hash that would never be recomputed,
  but they carry the `pack` and `path` markers the new identity is built from,
  so they are matched on either key and upgrading does not read as every issue
  disappearing at once.
## 0.1.0-alpha.7

### Patch Changes

- **A failed audit no longer reports as a clean one.** Found by running the
  scaffolded install against a deliberately unreachable model: Sentinel printed
  `0 finding(s) across 1 repository(ies)`, exited `0`, and committed a run
  record showing nothing. The per-pack reason was in the report body, but the
  headline, the exit code and the durable record all said clean — so a
  scheduled audit whose model was misconfigured or down would have gone green
  every morning while auditing nothing.

  A pack that reached the model and came back with nothing usable is now a
  run-level problem, alongside packs that failed to load and targets that could
  not be checked out. It appears in the **⚠️ Problems** section of the report on
  every path rather than only in a dry run's preview, is named on stderr, and
  makes the run exit non-zero so the workflow goes red.

  A pack that ran and found nothing is untouched — that is a clean result and
  still reads as one. The two states this separates are *nothing was found* and
  *nothing was looked at*.
- **A provider name the model runner cannot accept is now a config error.**
  Nanocoder validates `--provider` against `letters, digits, hyphens and
  underscores` and exits before doing anything else, so a name with a space in
  it turns every pack into a failed audit. `"MiniMax Coding"` is the realistic
  case: it is what the provider calls itself, and what an operator naturally
  writes into both `sentinel.yaml` and `agents.config.json`.

  Found by wiring Sentinel's own self-audit and watching all its packs fail
  with `Invalid --provider value`. It became reachable when `model.provider`
  started being passed through in the first place — before that the name never
  had to survive the CLI.

  `sentinel.yaml` refuses it at load now, where the message costs nothing, and
  `sentinel init` refuses to scaffold a config pair that cannot run. Both check
  the fallback provider too.
- **Marker-like text in a finding no longer corrupts the issue body.** Dedup
  state rides in hidden `<!-- sentinel:<key>=... -->` comments appended to each
  filed issue, and marker lookup trusted that an opener found in the body was
  always followed by a close. Issue bodies quote code read from the audited
  repository — `offending_snippet` is explicitly *the exact code* — so a snippet
  containing marker syntax was spliced against as if it were Sentinel's own
  marker.

  Two corruptions followed. An opener with **no close at all** sent the splice
  to a fixed index near the start of the body, pasting most of it back into
  itself: the filed issue arrived with its "Offending code" section, and
  everything after it, duplicated. An opener that **borrowed a later marker's
  close** was worse — a quoted `<!-- sentinel:misses=` sitting above the real
  markers terminated on the `hash` marker's ` -->`, so ageing the miss counter
  deleted every byte between them, taking the trailing body content and the
  real `hash` marker with it. An issue that loses its hash is no longer
  recognised on the next run, so the finding refiles as a duplicate.

  Fixed at both ends, because neither alone covers the other. Marker lookup now
  accepts a candidate only when it is genuinely a marker — a single-line comment
  holding an opaque scalar — and skips quoted openers instead of splicing
  against them, which also repairs issues already filed with one. And marker
  syntax in the four model-authored fields (`summary`, `rationale`,
  `offending_snippet`, `suggested_next_steps`) is neutralised before the body is
  built, so a newly filed issue cannot carry a colliding opener at all.

  That neutralising is a zero-width space, which is the one visible consequence:
  **a body whose text carried marker syntax is no longer byte-identical to the
  pre-fix output**, though it reads identically. Issues already filed keep
  working — their markers are still read and updated in place.

  Closes #40.
- **Run records carry a `schemaVersion`.** The dashboard reads every record
  ever committed, so the corpus is permanently mixed — and a reader told the
  shapes apart by which keys happened to exist. That works while every change
  is an added optional field, and stops working the first time one is not.

  Doing it now is the point: the record is a committed artifact that acquires a
  stability expectation the moment a stable version ships, so settling its
  shape is free on alpha and a migration afterwards. A record written before
  this field is version 0 and stays readable. A record from a **newer**
  Sentinel than the one reading it is skipped and named rather than parsed
  hopefully — the call the incremental cache already makes, because a dashboard
  rendered from a shape the reader does not understand is wrong without looking
  wrong.
- **The model subprocess no longer receives the GitHub token.** `buildNanocoderEnv`
  added `NANOCODER_CONFIG_DIR` to `process.env` and passed the rest through
  untouched, so the credential the shipped workflow provisions org-wide with
  `repo` and `issues` scope went to Nanocoder — along with the Actions OIDC and
  cache tokens — on every audit. Nanocoder has no use for any of them: it reads
  code and returns findings, and the token is spent afterwards by a separate
  spawn in `issues/gh-client.ts`. It is a credential handed to an agent running
  in auto-approve mode over a repository the operator does not control, with
  that repository's files in the prompt.

  The child environment is now built from an allowlist rather than inherited:
  process essentials, plus the variables your own `agents.config.json` names as
  `${PLACEHOLDER}` references, plus `NANOCODER_CONFIG_DIR`. Deriving the model
  credentials from your configuration rather than a built-in list of provider
  key names means a provider Sentinel has never heard of still authenticates.
  For a provider that reads its key straight from the environment and leaves no
  placeholder behind, `SENTINEL_PASSTHROUGH_ENV` names the variables to allow.
- Sentinel now audits itself on a schedule. No package behaviour changes — the
install lives in `.sentinel/` in this repository and uses the published package
exactly as any other config repo does.
- **The output contract now bounds what comes *before* the findings array, not
  just after it.** It said "write nothing after that line" and nothing at all
  about the other direction — so a model that narrated its way through the
  files for thousands of tokens and then opened the fence was following the
  contract exactly, right up until the output ceiling cut it off mid-sentence.
  Sentinel then reported malformed output for an audit that had, in fact, been
  done well.

  Found on the first real run of Sentinel's own self-audit: the model correctly
  identified that `gh` legitimately needs the token it is given, that the model
  subprocess now receives a scoped allowlist, and that the dedup markers defend
  themselves against quoted openers — and never reached the array. Adding one
  instruction not to narrate turned the same pack, same model and same files
  from `malformed output after 2 attempt(s)` into a clean pass.
- **The scaffolded install can actually run.** Following the quick start to its
  first dispatch produced a workflow that could not work, and nothing caught it
  because nothing ever ran one: no test exercised the generated workflow, and
  Sentinel does not audit itself. Three separate gaps, in the order a new
  install hit them.

  **Nanocoder was never installed.** Sentinel spawns a bare `nanocoder`; it is
  not a dependency and `npx @nanocollective/sentinel` does not bring it. The
  scaffolded workflow went checkout → setup-node → run, so the first model call
  died on `nanocoder is not on PATH` — a string that appeared nowhere in the
  docs, only in the error the operator was about to read. The workflow installs
  it now.

  **The runner and the provider disagreed by default.** `init` scaffolded
  `provider: ollama` alongside `runs-on: ubuntu-latest`, which has no local
  daemon. The runner follows the provider now: a local provider scaffolds
  `self-hosted`, a cloud provider scaffolds `ubuntu-latest`.

  **The scaffolded provider was not the configured one.** `init` wrote
  `provider: ollama` into `sentinel.yaml` and an example *cloud* provider into
  `agents.config.json`. Pointing Nanocoder at a config repo replaces its
  provider list rather than adding to it, so there is no auto-detected local
  fallback: every run came back `Provider 'ollama' not found in
  agents.config.json`. The provider entry is generated from the chosen provider
  now — local ones with their endpoint and no key, cloud ones with the secret
  placeholder — so the two files name the same provider by construction.

  **The model key never reached the model.** The workflow set `GH_TOKEN` and
  nothing else, while `agents.config.json` referenced `${SENTINEL_MODEL_KEY}`
  and the docs described an `endpoint_secret` naming an Actions secret. A cloud
  scaffold now writes the `env:` entry and the `${...}` placeholder from one
  `--endpoint-secret` option, so the two files cannot name different things.

- **`model.provider` is sent to the model runner.** It was required, validated,
  and then never passed — every run used whichever provider Nanocoder picked
  for itself, and the configured model id was resolved against it. It is passed
  as `--provider` now, switching together with the model id on fallback. If
  your `sentinel.yaml` names a provider your `agents.config.json` does not,
  that run now fails and says so rather than quietly using a different one.

- **The scaffolded workflow no longer interpolates a workflow expression into
  a shell script.** `dry_run` went straight into `run:` as `${{ ... }}`. The
  input is a typed boolean and cannot carry anything but `true` or `false`, so
  this was not reachable — but it is the shape of a shell injection, and this
  file is the one every install copies. It travels through the environment now.

- **The audit agent no longer carries tools it never uses.** The scaffolded
  `agents.config.json` disabled nothing, so the audit read untrusted code in
  auto-approve mode with shell, network, file writes and sub-agents available.
  Reading code and reporting on it needs none of them, and they are disabled in
  a fresh scaffold. Reading and searching are untouched.

- **`model.fallback.endpoint_secret` is gone.** It named the Actions secret
  holding the endpoint key and nothing ever read it, while
  `agents.config.json` named the same thing in the file that is actually
  consulted. One fact in two places, one of them inert. Configs still carrying
  it keep loading — unknown keys were always ignored.
- **One unreadable file no longer aborts the whole run.** `walkFiles` guarded
  its `readdirSync` and then called `statSync` on every discovered entry with
  nothing around it, so a dangling symlink, a permission-denied file or a file
  deleted mid-walk threw out of `fsRepoFiles.read`, past the `runFromConfig`
  loop, and out of `cli.ts` — which had no `.catch()` — as an unhandled
  rejection. Because one process audits every target in turn, a single bad file
  in the first repository left every repository after it unaudited, with no run
  record and nothing but a stack trace to say so. Every filesystem call on the
  walk is now guarded, the path is skipped, and the reason is reported. A rule
  pack that cannot be read is recorded as a pack error rather than silently
  dropped, so it shows up where a pack that failed to parse already does. The
  CLI grew a last-resort handler so anything still unexpected exits non-zero
  with its stack, named.
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
