# Usage

## Repository commands

| Command | Purpose |
|---|---|
| `bun run dev` | tsdown watch build into `dist/` |
| `bun run build` | Build every entry: ESM + CJS + type declarations |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `eslint . --fix` |
| `bun run lint:check` | Check only (CI) |
| `bun run test` | Run all tests once |
| `bun run test:watch` | Watch mode |
| `bun run test:coverage` | v8 coverage |
| `bun run check` | Full gate |
| `bun run check:docs` | Documentation links and index |
| `bun run verify:package` | Validate the publish tarball after a build |
| `bun run example` | Run `examples/basic.ts` |

## Writing code

```bash
# new module
src/<domain>/<file>.ts
tests/<domain>/<file>.test.ts
```

- `src/index.ts` and `src/shared/` must stay platform-neutral; no runtime `node:*` imports.
- Node-only code belongs in `src/cli`, `src/env`, `src/local`, `src/storage` or `src/commands`.
- Bun-only code belongs in `src/proxy` or `src/bin`.
- New exports require updates to `tests/exports.test.ts`, the API reference and the CHANGELOG.

## Commits

pre-commit runs `eslint --fix` on staged files. See [git-workflow](../engineering/git-workflow.md):

```bash
git commit -m "feat(cli): add --target passthrough"
```

pre-push runs `bun run build`; a failing build blocks the push.

## Release

```bash
# 1. fill in CHANGELOG.md
# 2. bump, commit, tag and push
bun run release
```

See [build-and-release](../engineering/build-and-release.md) and the [release checklist](../engineering/release-checklist.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bun install --frozen-lockfile` fails | Run `bun install` locally and commit `bun.lock` |
| pre-commit does not run | `bunx lefthook install` |
| `check-docs` reports an unregistered document | Add a row to `docs/README.md` |
| Release job reports a version mismatch | The tag and `package.json#version` differ; re-tag |
| Artifacts are incomplete | Run `bun run build` first, then `bun run verify:package` |
