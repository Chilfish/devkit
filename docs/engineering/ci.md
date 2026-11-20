# CI

The pipeline is defined in `.github/workflows/ci.yml`.

## Structure

| Job | Trigger | Contents |
|---|---|---|
| `check` | push to main / PR | typecheck, lint, coverage, build, artifact and docs verification, example run; uploads `dist` and `coverage` artifacts |
| `integration` | push to main / PR | Postgres 16 service; runs `tests/integration` with the real `@neondatabase/serverless` client and the background proxy |
| `windows` | push to main / PR | typecheck, lint, test, build and package verification on `windows-latest` (the platform-specific spawn and shim paths) |
| `runtime` | push to main / PR | depends on `check`; downloads `dist` and imports the ESM and CJS builds on Node 22 and 24 |

## Node versions

The toolchain (`tsdown`, TypeScript) requires Node ≥22, and `engines.node` is `>=22.22`:

- Build runs once in the `check` job on Node 24.
- `runtime` installs nothing and only consumes the `dist` artifact, verifying that the published output runs on supported Node versions.

## Conventions

- **Least privilege**: `permissions: contents: read`.
- **Cancel stale runs**: `cancel-in-progress: true`.
- **Lockfile**: `bun install --frozen-lockfile`; a stale `bun.lock` fails the job.
- **Coverage thresholds**: enforced by `vitest.config.ts` (`statements` 63, `branches` 57, `functions` 62, `lines` 64). Raise them with new tests; never lower them to make a build pass.
- **Integration**: `DEVKIT_PG_SMOKE=1` and `DEVKIT_PG_ADMIN_URL` are set only in the `integration` job; the other jobs skip database tests.
- **Windows**: the `windows` job covers the `.cmd` / `.exe` shim, quoted command line and detached process paths that Linux cannot execute.
- **Version alignment**: `packageManager`, the CI `bun-version` and the README must agree.
- **No skipped gates**: any failing step is red; no `continue-on-error`.

## Cache

`oven-sh/setup-bun@v2` caches dependencies. Never commit `node_modules`.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `lockfile had changes` | `bun.lock` not updated | Run `bun install` locally and commit |
| `Cannot find module 'dist/...'` | Build ran after the import step | Check step order |
| `eslint` fails only in CI | Local run auto-fixed files | Run `bun run lint:check` before pushing |
| Coverage dropped | New code without tests | Add tests instead of lowering the threshold |

## Changing workflows

1. Verify action versions exist (`checkout@v7`, `setup-bun@v2`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8`).
2. Reflect release changes in [build-and-release](./build-and-release.md).
3. Add new gates to [release-checklist](./release-checklist.md).
