---
"@nanocollective/sentinel": patch
---

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
