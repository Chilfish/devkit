# Build and release

## Build

Tool: **tsdown** (rolldown), configured in `tsdown.config.ts`.

| Item | Value | Reason |
|---|---|---|
| `entry` | four target groups | Neutral, Node and Bun boundaries stay in separate bundles |
| `format` | `esm` + `cjs` | Both `import` and `require` work |
| `dts` | `true` (except `./bin/proxy`) | Typed entries |
| `platform` | `neutral` / `node` per target | Prevents accidental Node builtins in neutral code |
| `outExtensions` | `.js` / `.cjs`, `.d.ts` / `.d.cts` | Matches `package.json#exports` |
| `exports` | `false` | `package.json#exports` is maintained by hand |

Artifacts:

```
dist/index.js                 dist/index.cjs
dist/shared/index.js          dist/shared/index.cjs
dist/cli/index.js             dist/cli/index.cjs
dist/env/index.js             dist/env/index.cjs
dist/local/index.js           dist/local/index.cjs
dist/proxy/index.js           dist/proxy/index.cjs
dist/storage/index.js         dist/storage/index.cjs
dist/commands/index.js        dist/commands/index.cjs
dist/bin/proxy.js
```

Type declarations mirror each entry. Shared chunks are emitted with hashed names.

CI checks the entry artifacts after building; `bun run verify:package` validates the tarball and every `exports` target.

## package.json contract

- Each entry is a condition object with `types` before `default`.
- `files` contains only `dist`, `LICENSE.md`, `README.md` and `.env.example`.
- `sideEffects: false`.
- `engines.node` matches the CI floor.
- `publishConfig.provenance: true`.

See [package-contract](../reference/package-contract.md).

## Release flow

1. Fill `CHANGELOG.md` under `## Unreleased`.
2. `bun run release` → bumpp bumps the version, commits, tags and pushes.
3. The tag triggers `.github/workflows/publish.yml`:
   - verify the tag matches `package.json#version`
   - verify `CHANGELOG.md` has a `## <version>` section
   - run typecheck / lint / test / build / package verification
   - `npm publish --provenance --access public`
4. Create a GitHub Release from the CHANGELOG section.

## Authentication

npm Trusted Publisher (OIDC); no `NPM_TOKEN`:

- workflow needs `permissions.id-token: write`;
- `setup-node` deliberately omits `registry-url`, which would write a placeholder token;
- bind the repository and workflow in the npm package settings before the first publish.

## Forbidden

- Publishing locally with `npm publish` (bypasses gates).
- Enabling `exports: true` in `tsdown.config.ts`.
- Releasing without a CHANGELOG entry (CI fails).
