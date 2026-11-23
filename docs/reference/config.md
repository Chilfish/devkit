# Configuration reference

`defineDevkit` validates and deeply freezes the configuration. Invalid input throws `DevkitConfigError` with a `field` pointing at the exact location; the CLI maps it to exit code 3.

## Fields

| Field | Required | Default | Notes |
|---|---|---|---|
| `identity.name` | yes | — | CLI name and envelope command prefix |
| `identity.description` | yes | — | Root command description |
| `identity.helpHint` | no | `bun run <name>` | Next step shown in error hints |
| `identity.jsonEnvVar` | no | — | Implicit JSON switch |
| `env.file` | no | `.env` | Base env file relative to the repository root; `<file>.dev` / `<file>.prod` are layered on top |
| `env.localFlag` | no | `LOCAL` | Master switch variable name |
| `database.localUrl` | yes | — | Must point at localhost / 127.0.0.1 / [::1] |
| `database.proxyEndpoint` | yes | — | Must be a local URL |
| `database.migrations` | yes | — | Drizzle migrations directory |
| `storage.bucket` | no | — | Local bucket name |
| `storage.dataDir` | no | `temp/silo-data` | SILO data directory |
| `storage.publicBaseEnv` | no | — | Variable that receives the derived public base in local mode |
| `paths.logs` | no | `logs` | Background service log directory |
| `dev.servers` | no | `[]` | Dev servers; omit it when the project only uses the env, database or proxy helpers |

## Dev servers

```ts
{
  name: 'astro',
  runtime: 'node',      // 'node' | 'bun', defaults to 'node'
  command: 'astro',     // resolved from node_modules/.bin, then PATH
  args: ['dev'],
}
```

Arguments after `--` on `dev server` are appended to the first server only.

## Validation rules

- `identity.name`, `identity.description`, `database.migrations`, server names and commands must be non-empty strings.
- `env.file` defaults to `.env`; an explicit value must be a non-empty string.
- `database.localUrl` and `database.proxyEndpoint` must be local URLs.
- `dev.servers` is optional and defaults to `[]`; `dev server` then fails with `NO_DEV_SERVERS` (exit 3).
- Every server `runtime` must be `node` or `bun`; `args` must be an array of strings.
- The result is frozen at every level.

## Example

```ts
import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: { name: 'ig', description: 'Tweet viewer', jsonEnvVar: 'IG_JSON' },
  env: { file: '.env', localFlag: 'LOCAL' },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/tweets_dev',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'packages/database/migrations',
  },
  storage: { bucket: 'tweets-viewer', publicBaseEnv: 'IG_CDN_BASE' },
  dev: {
    servers: [
      { name: 'server', command: 'vite', args: ['dev'] },
      { name: 'client', command: 'vite', args: ['dev'] },
    ],
  },
})
```

## Runtime state

The config is static. Runtime environment state lives in the env files and in `process.env`; `loadEnvFile` owns that transition.

`loadEnvFile` reads `env.file`, then `<file>.dev` when the local flag is on or `<file>.prod` when it is off. A missing mode file is skipped. Values from the mode file override the base file, and variables already in the process environment always win.

```text
.env            # shared defaults, committed
.env.dev        # local overrides, ignored
.env.prod       # deployment values, injected by the platform or ignored
```

The same key appears in every file with an environment-specific value. There are no suffixed keys to rename when shipping to production: the deployment sets the local flag to `0` (or leaves it unset), and `<file>.prod` supplies the remote values.
