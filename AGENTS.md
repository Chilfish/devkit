# AGENTS.md

Repository-level hard constraints. Details live in [docs/README.md](./docs/README.md); if they conflict with the code, the code wins and the docs are fixed in the same change.

## Stack

- Package manager: **Bun** (`bun.lock`, CI uses `--frozen-lockfile`)
- Build: **tsdown**, ESM + CJS, multiple entries with per-entry platforms
- Tests: **Vitest**, v8 coverage
- Style: **@antfu/eslint-config** with formatters; no Prettier
- Git hooks: **lefthook** (`lefthook.yml`)
- Release: tag-triggered GitHub Actions, npm OIDC + provenance

## Non-negotiables

1. Named exports only; no `export default`.
2. Type imports use `import type` / `export type`.
3. No `any`; use `unknown` plus type guards at the boundary.
4. Only `.` and `./shared` are platform-neutral; never import `node:*` from them.
5. `package.json#exports` and `tests/exports.test.ts` change together.
6. New logic needs tests; bug fixes start with a failing test.
7. Public contracts, build/release flow and incident fixes are documented first.
8. `lint:check` and `typecheck` must pass; no `--no-verify`.
9. Do not enable `exports: true` in `tsdown.config.ts`.
10. Update `bun.lock` whenever dependencies change.

## Common commands

```bash
bun install
bun run typecheck
bun run lint:check
bun run test
bun run build
bun run check        # full gate
bun run check:docs   # docs links and index
```

## Layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | `defineDevkit` and public config types (neutral) |
| `src/shared/` | Pure functions: URL checks, env parsing, local address derivation (neutral) |
| `src/cli/` | Command specs, runtime, envelope, exit codes, logger |
| `src/env/` | Environment file loading, local overrides, remote expansion, banner |
| `src/local/` | Postgres lifecycle, database, migrations, env file, proxy orchestration |
| `src/proxy/` | Neon `/sql` proxy (`Bun.serve`) |
| `src/storage/` | SILO lifecycle, bucket and anonymous read policy |
| `src/commands/` | Built-in `dev` command group |
| `src/bin/proxy.ts` | Background proxy entry, spawned by absolute path |
| `tests/` | Mirrors `src/`; contract tests lock the entry matrix |
| `examples/` | Runnable examples |
| `scripts/` | Gates and release scripts |
| `docs/` | Internal docs, index in `docs/README.md` |
| `.github/workflows/` | `ci.yml` / `publish.yml` |
| `.github/ISSUE_TEMPLATE/` | Issue templates |
