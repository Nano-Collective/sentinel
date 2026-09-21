---
"@nanocollective/sentinel": patch
---

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
