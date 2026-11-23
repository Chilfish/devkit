# Architecture

## Goal

A reusable local-development package: one source for CLI runtime, env layering, local Postgres, the Neon `/sql` proxy and SILO storage. Projects consume it as a dependency and inject differences through `defineDevkit`.

## Entry matrix

| Entry | Content | Build target | Worker-safe |
|---|---|---|---|
| `.` | `defineDevkit`, config types | neutral | yes |
| `./shared` | Pure URL/env helpers | neutral | yes |
| `./cli` | Command specs, runtime, logger | node | no |
| `./env` | Env file loading and banner | node | no |
| `./local` | Postgres, database, migrations, orchestration | node | no |
| `./proxy` | Neon `/sql` proxy | Bun runtime (node bundle) | no |
| `./storage` | SILO lifecycle and bucket policy | node | no |
| `./commands` | `createDevCommands` | node | no |
| `./pipeline` | Bounded-concurrency stage runner, snapshots, worker pool | node | no |
| `./bin/proxy` | Executable background proxy | Bun | no |

`package.json#exports` and `tests/exports.test.ts` change together; adding or removing an entry is a public contract change.

## Layers

```
src/index.ts         config definition and public types (neutral)
src/shared/          pure helpers (neutral)
src/cli/             command runtime, envelope, exit codes, logger
src/env/             env file loading, local overrides, remote expansion
src/local/           Postgres, database, migrations, env file, proxy lifecycle
src/storage/         SILO lifecycle and bucket policy
src/proxy/           HTTP protocol translation
src/pipeline/        bounded concurrency, stage state machine, snapshots, workers
src/commands/        built-in dev command group
src/bin/proxy.ts     background entry
```

Dependency direction: `commands → local → storage/util`, `cli → env → shared`, and everything may import `shared`. `shared` imports nothing. `pipeline` is a standalone leaf that imports nothing from the other modules.

## Runtime boundaries

- `src/index.ts` and `src/shared/` must not import `node:*` at runtime; `tests/contract/browser-build.test.ts` builds them with `bun build --target=browser` and asserts no builtins appear.
- Consumers should restrict Worker imports:

```js
// eslint.config.js
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['@chilfish/devkit/cli', '@chilfish/devkit/env', '@chilfish/devkit/local',
      '@chilfish/devkit/proxy', '@chilfish/devkit/storage', '@chilfish/devkit/commands'],
    message: 'Node/Bun-only entry; use @chilfish/devkit/shared in Workers',
  }],
}]
```

- `pg` and `drizzle-orm` are loaded dynamically inside local database operations, so consumers that only use the CLI entry do not need them at install time.

## Build

`tsdown.config.ts` contains four build targets:

1. neutral: `.` and `./shared`
2. node: `./cli`, `./env`, `./local`, `./storage`, `./commands`, `./pipeline` (plus the internal `pipeline/worker-entry` chunk)
3. neutral/Bun runtime: `./proxy` (tsdown has no `bun` platform, so it builds with `node` and `pg` stays external; the code still calls `Bun.serve`)
4. node/Bun runtime: `./bin/proxy` (ESM only, shebang preserved)

Output uses `.js` / `.cjs` and `.d.ts` / `.d.cts` extensions.

## Extension rules

| Need | Action |
|---|---|
| New subpath | Add `src/<name>/index.ts`, update `tsdown` entry, `package.json#exports`, `tests/exports.test.ts` and the API reference |
| New project-specific command | Build a `CommandGroup` in the consuming project; never add it here |
| New local service | Put it under `src/<service>/` with a health check, log file and `dry-run` branch |
