---
"@nanocollective/sentinel": patch
---

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
