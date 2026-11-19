# Getting started

## Requirements

| Tool | Version | Purpose |
|---|---|---|
| Bun | 1.4.4+ | Install, scripts, local development, proxy runtime |
| Node.js | 22.22+ | CLI and local service orchestration |
| Git | 2.4+ | lefthook hooks |

Bun is pinned in `package.json#packageManager`; CI uses the same version.

## Install

```bash
bun add -d @chilfish/devkit
```

Install `pg` and `drizzle-orm` as well when you use the local database stack.

## Write the config

```ts
// dev.config.ts
import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: { name: 'ymmt', description: 'Data pipeline', helpHint: 'bun run ymmt' },
  env: { file: '.dev.vars' },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/ymmt_dev',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'drizzle',
  },
  storage: { bucket: 'yumemita-data', publicBaseEnv: 'PUBLIC_R2_BASE' },
  paths: { logs: 'temp' },
  dev: { servers: [{ name: 'astro', runtime: 'node', command: 'astro', args: ['dev'] }] },
})
```

`defineDevkit` validates and freezes the object. It does not read files, write `process.env` or print anything.

## Wire up the CLI

```ts
import { buildCli, runCli } from '@chilfish/devkit/cli'
import { createDevCommands } from '@chilfish/devkit/commands'
import { devkit } from './dev.config'

const groups = [createDevCommands(devkit)]

await runCli(
  buildCli({ config: devkit, version: '1.0.0', groups }),
  process.argv.slice(2),
)
```

Add project-specific commands as `CommandGroup`s and pass them through `groups`; top-level commands go through `rootCommands`.

## Environment file

The env module reads `env.file` and fills only keys missing from the process environment.

- With the local flag on, `DATABASE_URL`, `NEON_HTTP_ENDPOINT` and the configured public base are forced to local values.
- With the local flag off, `<KEY>_ONLINE` values are expanded into `<KEY>`.
- Explicit process variables always win.

## First run

```bash
LOCAL=1 bun run dev db     # start Postgres, create the database, migrate
bun run dev server         # start the local stack and the configured servers
```

## Next steps

- [Local development](./local-dev.md)
- [CLI contract](./cli.md)
- [Configuration reference](../reference/config.md)
