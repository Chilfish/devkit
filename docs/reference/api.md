# Public API

Eight typed entries plus one executable entry. `package.json#exports` and `tests/exports.test.ts` lock this matrix.

## Entries

| Entry | Exports | Platform |
|---|---|---|
| `@chilfish/devkit` | `defineDevkit`, `DevkitConfig`, `DevkitConfigError`, pure helpers | neutral |
| `@chilfish/devkit/shared` | `isLocalUrl`, `isLocalMode`, `parseEnvContent`, `upsertEnvValues`, `localPublicBase`, `localEndpoint`, `localBucket`, `parseDatabaseInfo` | neutral |
| `@chilfish/devkit/cli` | `CommandSpec`, `CommandGroup`, `CommandContext`, `buildCli`, `runCli`, `describeCli`, `createLogger`, envelope and exit helpers | node |
| `@chilfish/devkit/env` | `loadEnvFile`, `describeEnvironment`, `readEnvFile` | node |
| `@chilfish/devkit/local` | `ensureDevServices`, Postgres / database / migration / env-file / proxy helpers | node |
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
import { buildCli, runCli } from '@chilfish/devkit/cli'
```

`buildCli({ config, version, groups, rootCommands })` returns a commander `Command`; `runCli(program, argv)` runs it and normalizes help/version/argument errors.

## Env

```ts
import { loadEnvFile, describeEnvironment } from '@chilfish/devkit/env'
```

## Local

```ts
import { ensureDevServices } from '@chilfish/devkit/local'
const { databaseUrl, endpoint } = await ensureDevServices({ config })
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
