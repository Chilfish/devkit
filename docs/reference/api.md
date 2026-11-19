# Public API

Eight typed entries plus one executable entry. `package.json#exports` and `tests/exports.test.ts` lock this matrix.

## Entries

| Entry | Exports | Platform |
|---|---|---|
| `@chilfish/devkit` | `defineDevkit`, `DevkitConfig`, `DevkitConfigError`, pure helpers | neutral |
| `@chilfish/devkit/shared` | `isLocalUrl`, `isLocalMode`, `parseEnvContent`, `upsertEnvValues`, `localPublicBase`, `localEndpoint`, `localBucket`, `parseDatabaseInfo` | neutral |
| `@chilfish/devkit/cli` | `CommandSpec`, `CommandGroup`, `CommandContext`, `buildCli`, `runCli`, `describeCli`, `createLogger`, `requireEnv`, `requireEnvVar`, envelope and exit helpers | node |
| `@chilfish/devkit/env` | `loadEnvFile`, `describeEnvironment`, `readEnvFile`, `readOnlineTarget`, `applyOnlineEnv` | node |
| `@chilfish/devkit/local` | `ensureDevServices` (with `databaseUrl` / `endpoint` overrides), Postgres / database / migration / env-file / proxy helpers | node |
| `@chilfish/devkit/proxy` | `createProxyHandler`, `startProxy` | Bun |
| `@chilfish/devkit/storage` | `ensureSiloRunning`, `ensureLocalBucket`, `resolveSiloBinary`, `readLocalCredentials` | node |
| `@chilfish/devkit/commands` | `createDevCommands`, `resolveCommand` | node |
| `@chilfish/devkit/bin/proxy` | Executable background proxy entry | Bun |

## Root

```ts
import { defineDevkit } from '@chilfish/devkit'

const config = defineDevkit({ /* see config reference */ })
```

The root entry does not read files, touch `process.env` or print. It is safe for Workers and browsers.

## Shared

`shared` is pure: no `node:*` or `bun:*` imports, no side effects.

```ts
import { isLocalMode, isLocalUrl } from '@chilfish/devkit/shared'
```

## CLI

```ts
import { buildCli, runCli, requireEnv } from '@chilfish/devkit/cli'
```

`buildCli({ config, version, groups, rootCommands, labels })` returns a commander `Command`; `runCli(program, argv)` runs it and normalizes help/version/argument errors. Pass `labels.exitCodes` / `labels.globalOptions` to keep an existing `describe` contract in the host's language.

`requireEnv(name, message?)` throws a plain `Error` (runtime exit code 1). Use `requireEnvVar` when a missing variable is a configuration error (exit code 3).

## Env

```ts
import { loadEnvFile, describeEnvironment, readOnlineTarget, applyOnlineEnv } from '@chilfish/devkit/env'
```

`readOnlineTarget({ config, cwd? })` reads `DATABASE_URL<suffix>` from the env file and refuses a local target. `applyOnlineEnv({ config, remote })` expands `<KEY><suffix>`, sets the local flag to `0`, clears local-only endpoints, and returns a restore function.

## Local

```ts
import { ensureDevServices } from '@chilfish/devkit/local'
const { databaseUrl, endpoint } = await ensureDevServices({
  config,
  databaseUrl: 'postgres://postgres@localhost:5433/bench',
  endpoint: 'http://127.0.0.1:4446/sql',
})
```

## Proxy

```ts
import { createProxyHandler, startProxy } from '@chilfish/devkit/proxy'
```

`createProxyHandler({ databaseUrl })` returns a request handler plus `close()`. `startProxy({ databaseUrl, port })` wraps it with `Bun.serve` and returns `{ url, port, close }`.

## Storage

```ts
import { ensureSiloRunning, ensureLocalBucket } from '@chilfish/devkit/storage'
```

## Commands

```ts
import { createDevCommands } from '@chilfish/devkit/commands'
const devGroup = createDevCommands(config)
```

## Contract rules

- Named exports only; no default export.
- Adding or removing an entry is a public contract change: update `tests/exports.test.ts`, this document and the CHANGELOG.
- `pg` and `drizzle-orm` are only loaded when local database work runs.
