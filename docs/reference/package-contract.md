# package.json contract

`package.json` is the single source of truth for the published artifact. The build never rewrites release fields.

## Required fields

| Field | Current value | Constraint |
|---|---|---|
| `name` | `@chilfish/devkit` | Must match the npm package name |
| `type` | `module` | Source and ESM output are parsed as ESM |
| `packageManager` | `bun@1.4.4` | Must match the CI Bun version |
| `sideEffects` | `false` | Keeps the package tree-shakeable |
| `files` | `.env.example` / `LICENSE.md` / `README.md` / `dist` | Only the template, docs and build output; no source, tests, scripts or docs |
| `engines.node` | `>=22.22` | Matches the CI runtime floor |
| `publishConfig` | `access: public`, `provenance: true` | OIDC publish with provenance |

## exports

Eight typed entries plus the binary:

```json
{
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  },
  "./shared": { "import": { "types": "./dist/shared/index.d.ts", "default": "./dist/shared/index.js" }, "require": { "types": "./dist/shared/index.d.cts", "default": "./dist/shared/index.cjs" } },
  "./bin/proxy": "./dist/bin/proxy.js",
  "./package.json": "./package.json"
}
```

Rules:

- `types` sits inside each condition branch and before `default`.
- No bare string exports except the executable.
- Every declared target must exist; `bun run verify:package` checks this and the tarball contents.
- New subpaths require updates to `tests/exports.test.ts` and this document.

## Top-level compatibility fields

`main` / `module` / `types` remain for older tooling:

| Field | Value |
|---|---|
| `main` | `./dist/index.cjs` |
| `module` | `./dist/index.js` |
| `types` | `./dist/index.d.ts` |

New code should rely on `exports`.

## Dependencies

- `dependencies`: `commander`, `aws4fetch`.
- `peerDependencies`: `pg`, `drizzle-orm`, both optional.
- Toolchain lives in `devDependencies`.
- Update `bun.lock` with every dependency change.
- Policy details: [dependencies](../engineering/dependencies.md).

## Scripts

| Script | Contract |
|---|---|
| `build` | Only `tsdown`; no extra copies |
| `check` | Full gate, shared by CI and local |
| `verify:package` | Validates exports, artifacts and tarball |
| `prepublishOnly` | Build only, to prevent accidental publishes |
| `release` | Version bump, commit, tag, push; never publishes locally |
