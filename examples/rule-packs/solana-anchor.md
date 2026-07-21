---
name: solana-anchor
version: 0.1.0
description: "Illustrative security pack for Solana programs written with Anchor."
applies_to:
  paths: ["programs/**/*.rs"]
  languages: ["rust"]
severity_weighting:
  missing-signer-check: critical
  missing-owner-check: high
  account-confusion: high
  unchecked-pda-derivation: high
  missing-account-validation: high
  arithmetic-overflow: medium
depends_on: ["rust-general"]
category: security
---

# What this pack audits

You are reviewing an Anchor-based Solana program. These programs handle user
funds, so access-control and account-validation bugs are high-impact. Review the
instruction handlers and account structs. Report only issues supported by the
code shown; when you cannot tell whether a constraint exists elsewhere, file at
**low confidence** and note the ambiguity.

## Flag these

- **Missing signer check.** An instruction that mutates state or moves funds but
  never asserts the expected authority signed — e.g. an `AccountInfo` or
  unchecked account where a `Signer` constraint (or `has_one` / `constraint`)
  was expected.
- **Missing owner check.** An account read or written without verifying its
  program owner, allowing a caller to substitute an account from another program.
- **Account confusion.** Two accounts of the same type where the handler does
  not validate which is which, letting a caller swap them.
- **Unchecked PDA derivation.** A PDA used without verifying its seeds/bump
  against the expected derivation, or `seeds`/`bump` constraints omitted.
- **Missing account validation.** `AccountInfo` / `UncheckedAccount` used without
  a documented reason and without manual validation.
- **Arithmetic overflow.** Token-amount or balance math using unchecked `+`/`-`/`*`
  instead of `checked_*` operations.

## Severity guidance

- Missing signer check on a fund-moving instruction: **critical**.
- Missing owner check, account confusion, or unchecked PDA derivation on a
  privileged path: **high**.
- Missing validation on a read-only account, or overflow in non-fund math:
  **medium**.
- A convention deviation with no security consequence: **low**, lower confidence.

## Do not flag

- Handlers whose authority is enforced by an Anchor `Signer`, `has_one`,
  `constraint`, or `#[access_control(...)]` — the check is present, just not
  inline.
- `UncheckedAccount` with a `/// CHECK:` doc comment explaining why it is safe.
- PDA derivations under modules documented as exempt from the seed convention.
- Arithmetic on values with proven bounds or already using `checked_*`.
