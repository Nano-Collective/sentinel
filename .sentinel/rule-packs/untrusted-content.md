---
name: untrusted-content
version: 1.0.0
description: "Content Sentinel did not write — audited repository files, model output, GitHub issue bodies — reaching a place that trusts it."
applies_to:
  # Where content Sentinel did not write actually arrives: issue bodies and the
  # dedup markers inside them, the model spawn and its environment, findings
  # validation, and the defaults the scaffolder ships.
  #
  # Scoped rather than `source/**/*.ts` for the context-budget reason in
  # `silent-failure` — see #48.
  paths:
    - "source/issues/**/*.ts"
    - "source/dedup/**/*.ts"
    - "source/orchestrator/**/*.ts"
    - "source/findings/**/*.ts"
    - "source/init/**/*.ts"
    - "template/**/*.yml"
    - "template/**/*.json"
  languages: ["typescript", "yaml", "json"]
severity_weighting:
  credential-overreach: critical
  unvalidated-splice: high
  trusted-model-output: high
  agent-capability: high
depends_on: []
category: security
---

# What this pack audits

You are reviewing Sentinel, a TypeScript CLI that clones repositories it does
not control, pastes their files into a prompt, runs an AI agent over them in
auto-approve mode, and writes the agent's output into GitHub issues using a
token scoped across an entire organisation.

Three kinds of content flow through this codebase, and **none of them are
Sentinel's own**:

1. **Files from the audited repository.** Arbitrary, attacker-influenceable in
   the general case — anyone who can open a pull request on a repo Sentinel
   audits can put bytes in front of the model.
2. **Model output.** Structurally validated, but the free-text fields are
   whatever the model produced, and they quote the files above.
3. **Existing GitHub issue bodies**, read back during reconciliation, which may
   have been edited by anyone with write access.

Every finding in this pack is one of those three reaching code that treats it as
if Sentinel had written it.

## Flag these

- **`credential-overreach`.** A credential reaching a process that has no
  functional need for it. Look hardest at what is handed to the model
  subprocess: it reads code and returns findings, so a GitHub token, an OIDC
  token, a registry token or a cache token in its environment is capability it
  never spends. Also flag a token logged, written into a file that gets
  committed, or embedded in an issue body.

  Passing the *whole* parent environment to a child counts, even without a
  named credential, because what is in it is decided elsewhere.

- **`agent-capability`.** Configuration that leaves the audit agent holding
  tools it does not need — shell execution, network fetch, file writes, git
  push, sub-agent spawning — while it processes repository content it did not
  write. This applies to the `agents.config.json` that Sentinel *scaffolds* as
  much as its own: a shipped default is the configuration most installs will
  run forever.

- **`unvalidated-splice`.** String surgery — `indexOf` plus `slice`, a manual
  index arithmetic, a regex replace — performed on a body that contains
  untrusted content, where a not-found result (`-1`) or an unexpected match
  position is not checked before it is used as an offset. Sentinel stores dedup
  state as HTML comments inside issue bodies that also quote audited code, so
  "the delimiter I am looking for is also in the quoted text" is a real input,
  not a hypothetical one.

- **`trusted-model-output`.** A model-authored field used somewhere its content
  changes behaviour rather than just being displayed: as a lookup key, a file
  path, a shell argument, a URL, an issue-routing decision, or a delimiter. The
  validator checks shape — that severity is one of four values, that a file and
  line range are present — not meaning. A field that passed validation is still
  whatever the model said.

## Severity guidance

- A credential reaching the model subprocess, or any process that does not
  need it: **critical**.
- Untrusted content reaching a splice, a path, or a command: **high**.
- A shipped default that grants the agent write, shell, or network access:
  **high**.
- Model output used as a display string only, where the worst case is ugly
  rendering: **low**, and only worth raising if the rendering could be
  misleading rather than merely untidy.

## Do not flag

- Reads of the operator's own configuration — `sentinel.yaml`,
  `agents.config.json`, the rule packs. Those are files the operator wrote in a
  repository they control, and treating them as hostile would mean Sentinel
  distrusting its own install.
- The audited repository's opt-in `sentinel.yaml` override. It is deliberately
  honoured from the audited repo; that is a documented feature, and the
  suppression it grants is the repo maintainer's to give.
- `nosemgrep` annotations on filesystem reads whose paths come from the
  operator's config. The annotation is there because the path is trusted, and
  the reasoning is written next to it.
- Prompt injection *in general* as an abstract risk. Sentinel's threat model
  accepts that audited code reaches the model — that is the product. Flag a
  concrete path where injected content reaches something with an effect
  (a credential, a write, a command, a routing decision), not the fact that a
  model reads untrusted text.
- Test files (`*.spec.ts`) and fixtures.
