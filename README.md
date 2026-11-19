# devkit

Shared local development infrastructure for my projects: CLI runtime, layered environment loading, local Postgres orchestration, a Neon-compatible `/sql` proxy and SILO object storage.

One source, many consumers. Project differences are injected through a single `defineDevkit` config; nothing project-specific lives in the package.

## Features

- **Single implementation** — CLI runtime, env layering, local services and storage are consumed as a dependency instead of being copied.
- **Configuration only** — names, file paths, database URLs, buckets and dev servers come from `defineDevkit`.
- **Machine contract** — `--json` emits a one-line envelope, exit codes are fixed, logs go to stderr, and `describe` prints the whole command tree.
- **Local stack** — one command starts Postgres, creates the database, applies migrations, starts the `/sql` proxy and SILO, then reuses them on the next run.
- **Runtime boundaries** — only `.` and `./shared` are platform-neutral; Node and Bun capabilities live in subpath entries.
- **No silent divergence** — the entry matrix and package contract are locked by tests.

## Requirements

| Tool | Version |
|---|---|
| Bun | 1.4.4+ (required by `./proxy` and `./bin/proxy`) |
| Node.js | 22.22+ |

## Install

```bash
bun add -d @chilfish/devkit
```

`pg` and `drizzle-orm` are optional peers; install them only if you use the local database stack.

## Configure

```ts
// dev.config.ts
import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: {
    name: 'ymmt',
    description: 'Data pipeline',
    helpHint: 'bun run ymmt',
    jsonEnvVar: 'YMMT_JSON',
  },
  env: { file: '.dev.vars' },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/ymmt_dev',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'drizzle',
  },
  storage: {
    bucket: 'yumemita-data',
    dataDir: 'temp/silo-data',
    publicBaseEnv: 'PUBLIC_R2_BASE',
  },
  paths: { logs: 'temp' },
  dev: {
    servers: [{ name: 'astro', runtime: 'node', command: 'astro', args: ['dev'] }],
  },
})
```

## Wire up the CLI

```ts
import { defineDevkit } from '@chilfish/devkit'
import { buildCli, runCli } from '@chilfish/devkit/cli'
import { createDevCommands } from '@chilfish/devkit/commands'

const groups = [createDevCommands(devkit)]

await runCli(buildCli({ config: devkit, version, groups }), process.argv.slice(2))
```

## Commands

| Command | Purpose |
|---|---|
| `dev server` | Bring up the local stack, then run every configured server |
| `dev db` | Start Postgres, create the database, run migrations, sync the env file |
| `dev proxy` | Run the Neon-compatible proxy in the foreground |
| `dev storage` | Start SILO and prepare the bucket |
| `describe` | Print the command tree as JSON |

Every command accepts `--json`, `--quiet`, `--dry-run`, `--log-level` and `--log-file`.

## Repository scripts

| Command | Purpose |
|---|---|
| `bun run dev` | tsdown watch build |
| `bun run build` | Build all entries (ESM + CJS + types) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` / `lint:check` | ESLint with fixes / check only |
| `bun run test` / `test:coverage` | Unit, contract and integration tests |
| `bun run check` | Full gate: types, lint, coverage, build, package verification |
| `bun run check:docs` | Documentation links and index check |
| `bun run verify:package` | Validate the published tarball |
| `bun run release` | Bump version, commit, tag and push |

## Documentation

- [docs/README.md](./docs/README.md) — documentation index
- [Getting started](./docs/guide/getting-started.md) — install, configure, wire up
- [Local development](./docs/guide/local-dev.md) — Postgres, proxy, SILO
- [CLI contract](./docs/guide/cli.md) — `CommandSpec`, `--json`, exit codes
- [Architecture](./docs/engineering/architecture.md) — layers and entry matrix

## License

[MIT](./LICENSE.md)
