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

The published example packs live alongside the source in the [Sentinel repository](https://github.com/Nano-Collective/sentinel) and are listed here as they are written and released. Each is drawn from a real NC audit and clearly labelled as illustrative.

<!--
As packs are published, list them here, e.g.:

- **`rust-general`** — `unwrap`/`panic` in hot paths, error-handling patterns. From the Nanocoder audit.
- **`node-server`** — unbounded queries, unvalidated input, unsafe deserialisation. From the ContentForest worker audit.
-->

_No example packs have been published yet. This page is scaffolded ahead of the first release; the list will fill in as NC's dogfooding produces packs worth publishing._

## Contributing an example

NC's example packs are maintained in the Sentinel repository. General-purpose community packs do **not** belong there — publish those in your own repository and share them via [Discord](https://discord.gg/ktPDV6rekE) or your own catalogue. See [Contributing](../community.md#contributing) for the reasoning.
