# Example rule packs

These are **illustrative** rule packs — worked examples to read, learn from, and
adapt. They are **not** a maintained product, not defaults, and not something
Sentinel bundles or fetches. Sentinel ships no rule packs; the organisation that
owns the code being audited is the right author of its packs.

Copy one into your config repo's `rule-packs/` directory, then **rewrite it for
your code** — especially the "Do not flag" section, which is where an inherited
pack is most wrong for you. Calibrate it with a local run before going live:

```bash
npx @nanocollective/sentinel run \
  --rule-pack ./rule-packs/<name>.md \
  --repo ../your-repo \
  --output findings.md
```

See the [authoring guide](https://docs.nanocollective.org/sentinel/docs/rule-packs/authoring)
for how to write a good pack.

| Pack | For |
| --- | --- |
| `node-server.md` | TypeScript/Node backend services |
| `rust-general.md` | General Rust codebases |
| `solana-anchor.md` | Solana programs written with Anchor |
