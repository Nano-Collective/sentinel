---
"@nanocollective/sentinel": patch
---

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
