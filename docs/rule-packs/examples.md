---
title: "Example Packs"
description: "Worked example rule packs published from the Nano Collective's own audits, marked illustrative"
sidebar_order: 2
---

# Example Packs

The Nano Collective uses Sentinel on its own repositories and writes its own internal packs. A small set of those are published here as **worked examples** — something to read and adapt, not a maintained catalogue.

> These packs are **illustrative**. They are not a maintained product, not a default ruleset, and not something Sentinel bundles or fetches. Treat them the way you would treat a colleague's code-review checklist: a good starting point that you rewrite for your own code. The same posture applies to the `_starter/` pack that `init` scaffolds — see [Installation](../getting-started/installation.md#the-starter-pack-and-why-it-is-disabled).

## How to use an example

1. Copy it into your config repo's `rule-packs/` directory under a real name.
2. Read the whole body and delete anything that does not apply to your code.
3. Rewrite the "do not flag" section for *your* conventions — this is where an inherited pack is most wrong for you.
4. [Calibrate it locally](authoring.md#calibrate-before-you-file) before assigning it to a target.

An example pack you install without reading is exactly the failure mode the no-defaults policy exists to prevent.

## The starter pack

`npx @nanocollective/sentinel init` writes `rule-packs/_starter/example.md`: a single pack that exercises **every manifest field** and demonstrates the four body sections from the [authoring guide](authoring.md#anatomy-of-a-good-body). It is disabled by the underscore prefix and does not run until you opt in.

Its purpose is structural — to show you the shape of a complete pack — not to audit anything real.

## Published examples

The published example packs live under [`examples/rule-packs/`](https://github.com/Nano-Collective/sentinel/tree/main/examples/rule-packs) in the Sentinel repository. Each is clearly labelled illustrative and is validated in CI (a broken worked example is worse than none). Read them, copy one into your config repo's `rule-packs/`, and rewrite it for your code — especially the "Do not flag" section.

- **[`node-server`](https://github.com/Nano-Collective/sentinel/blob/main/examples/rule-packs/node-server.md)** — TypeScript/Node backend services: SQL/command injection, SSRF, path traversal, unsafe deserialisation, hardcoded secrets, unbounded queries.
- **[`rust-general`](https://github.com/Nano-Collective/sentinel/blob/main/examples/rule-packs/rust-general.md)** — general Rust: panic-on-external-input, `unwrap` in hot paths, unchecked `unsafe`, integer overflow.
- **[`solana-anchor`](https://github.com/Nano-Collective/sentinel/blob/main/examples/rule-packs/solana-anchor.md)** — Anchor Solana programs: missing signer/owner checks, account confusion, unchecked PDA derivation, arithmetic overflow. Depends on `rust-general`.

## Contributing an example

NC's example packs are maintained in the Sentinel repository. General-purpose community packs do **not** belong there — publish those in your own repository and share them via [Discord](https://discord.gg/ktPDV6rekE) or your own catalogue. See [Contributing](../community.md#contributing) for the reasoning.
