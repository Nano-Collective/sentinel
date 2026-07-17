---
title: "Getting Started"
description: "Install Sentinel into your GitHub organisation, write your first rule pack, and get the first audit run green"
sidebar_order: 2
---

# Getting Started

This section takes you from nothing to a scheduled audit filing real issues. There are four moves: install the scaffold, configure your targets, write your first rule pack, and prove the run.

The one thing to understand up front: **Sentinel does nothing until you write a rule pack.** It ships none of its own. A fresh install audits nothing, on purpose — the value is entirely in the packs you write for the code you ship. Budget most of your setup time for [writing that first pack](../rule-packs/authoring.md).

## In This Section

- [Installation](installation.md) — Requirements, the `init` scaffold, and the template fallback
- [Quick Start](quick-start.md) — A step-by-step walkthrough from `init` to your first filed issue

## The shape of an install

```
your-org/sentinel-config/        # a dedicated repo you create; not one of the audited repos
├── sentinel.yaml                # targets, schedule, model, severity threshold
├── rule-packs/
│   ├── _starter/                # illustrative starter pack, NOT auto-enabled
│   │   └── example.md
│   └── your-first-pack.md       # the pack you write
└── .github/workflows/
    └── sentinel.yml             # the scheduled audit workflow
```

Everything lives in one configuration repository inside your organisation. Findings are filed on the *audited* repositories, not here. Removing Sentinel is deleting this repo — there is no external service to deauthorise.
