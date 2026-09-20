---
"@nanocollective/sentinel": patch
---

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
