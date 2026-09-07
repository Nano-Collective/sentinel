# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
markdown file per user-facing change, describing what changed and how the
version should bump.

Add one with:

```bash
pnpm changeset
```

Pick a bump (patch / minor / major) and write the entry in the house voice —
the file body becomes the changelog entry verbatim. Commit the generated file
alongside your change.

Chores, refactors, CI and docs need no changeset. To record that deliberately,
use `pnpm changeset --empty`.

Changesets accumulate on `main` until the **Version Packages** pull request is
merged, which bumps the version and rolls the entries into `CHANGELOG.md`.
Merging that pull request is what triggers a release.

## Pre mode — read this before cutting v1

`pre.json` puts this repository in changesets' **pre mode**, tagged `alpha`. It
is load-bearing, not decoration. Without it `changeset version` treats
`0.1.0-alpha.3` as an ordinary prerelease to be resolved, and a single patch
changeset bumps it to **`0.1.0`** — so the first Version PR merged would ship
v1, claim npm's `latest` tag, and skip the rest of the alpha series in one go.

In pre mode the same changeset bumps `0.1.0-alpha.3` → `0.1.0-alpha.4`, which is
what the [roadmap](../ROADMAP.md) expects for every release up to v1.

**Cutting `1.0.0` is therefore a deliberate two-step**, not the absence of a
step:

```bash
pnpm changeset pre exit   # deletes pre.json
pnpm changeset version    # 0.1.0-alpha.N -> 1.0.0
```

Do that only when the roadmap's phase 3 is complete. Deleting `pre.json` at any
other time releases v1 by accident.
