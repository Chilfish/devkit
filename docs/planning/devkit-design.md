# devkit: a single implementation of local development infrastructure

> Status: draft (2026-11-19). Facts are in [current-state.md](./current-state.md).
> This document defines package shape, public API, behavior contracts and migration stages. Do not describe "will support" as "supported" before implementation.

## 1. Problem

The same person reimplements the same local infrastructure across projects, and the copies have already diverged: CLI behavior, environment semantics and proxy startup each evolve separately, so one bug must be fixed twice. Copy-paste cannot solve synchronization; the only fix is to converge the code into one versioned dependency.

## 2. Goals

| ID | Goal | Acceptance signal |
|---|---|---|
| FR-1 | Single implementation: one source, consumed as a dependency | Downstream `git grep` finds no duplicate runtime / dev-services / dev-silo |
| FR-2 | Configurable: all project differences injected, no project constants in source | `grep -r "ymmt\|tweets-viewer\|ymmt_dev" src/` returns nothing |
| FR-3 | Machine contract: one-line `--json` envelope, fixed exit codes, `describe`, logs on stderr | Contract tests cover exit codes 0/1/2/3 and envelope fields |
| FR-4 | Local chain: one command starts Postgres + database + migrations + `/sql` proxy + SILO, reused in background | Stopping the proxy then running `dev` re-starts it; `/health` database matches the target |
| FR-5 | Environment isolation: fixed `LOCAL` / `*_ONLINE` precedence, remote mode rejects local databases | Precedence matrix unit tests; mixed state is rejected with a next step |
| FR-6 | Runtime boundaries: Workers may import only pure entries; Node/Bun capabilities in subpaths | Entry matrix test + browser-target build assertion |
| FR-7 | Single source of docs: guides live in devkit; downstream keeps only differences and specific troubleshooting | Downstream docs no longer copy conceptual sections |
| FR-8 | Publishable: public npm package, peers do not force downstream upgrades | `bun pm pack --dry-run` contains only expected files; fixture install works |
| FR-9 | Verifiable: unit + integration + downstream smoke, verification always carries a signal | CI and the release checklist are executable step by step |

## 3. Non-goals

- **Not a framework**: it does not own the business command tree (fetch, ingest, publish, validate).
- **No cross-runtime promise**: the `/sql` proxy is based on `Bun.serve`, matching both downstream projects; Node support is an open question, not part of 0.1.
- **No cloud orchestration**: it does not create Neon / R2 / domains and does not replace wrangler.
- **No multi-tenancy**: one config per project; other projects' configs are never read.
- **Not zero-dependency**: the CLI needs `commander`, storage policy needs `aws4fetch`; `pg` / `drizzle-orm` remain optional peers.

## 4. Key decisions

| ID | Decision | Trade-off |
|---|---|---|
| D1 | Standalone repository + **publishable package** | Copy templates demonstrably drift; a monorepo couples applications with different release cycles; putting this into `starter-ts-lib` breaks its zero-runtime-dependency positioning |
| D2 | **Single package + subpath exports** | Four packages would complicate peers and version matrices too early; subpaths isolate runtimes and can be split later (§14) |
| D3 | Proxy stays **Bun-only** | Matches both existing implementations and avoids rewriting protocol details; Node support waits for a real need |
| D4 | Publish to **public npm** | No secrets, no CI login; git dependencies would couple CI to repository permissions and network paths |
| D5 | Pure functions for Workers (`./shared`) | Only URL checks and env text parsing, no dependencies; built as neutral and tested to have no `node:` imports |

## 5. Package shape

### 5.1 Repository layout

```text
src/
├─ index.ts                 # defineDevkit + public types; no node/bun imports
├─ shared/                  # Pure functions: URL checks, env parsing, local address derivation
├─ cli/                     # runtime / envelope / exit / logger / describe
├─ env/                     # env file loading, LOCAL overrides, *_ONLINE expansion, banner
├─ local/                   # Postgres orchestration, database, migrations, env file, stack
├─ proxy/                   # Neon /sql protocol translation (Bun.serve)
├─ storage/                 # SILO / MinIO orchestration and bucket policy
├─ commands/                # built-in dev command group
└─ bin/
   └─ proxy.ts              # background proxy entry, spawned by absolute path
tests/                      # mirrors src/
docs/                       # index in docs/README.md
```

### 5.2 Entry matrix

| Entry | Content | Build target | Worker-safe |
|---|---|---|---|
| `.` | `defineDevkit`, config types | neutral | yes (pure functions and types only) |
| `./shared` | `isLocalUrl` / `isLocalMode` / `parseEnvContent` / `localPublicBase` | neutral | yes |
| `./cli` | `CommandSpec`, `buildCli`, `runCli`, logger | node | no |
| `./env` | load and override env files | node | no |
| `./local` | Postgres lifecycle, database, migrations, stack orchestration | node | no |
| `./proxy` | `/sql` proxy | bun | no |
| `./storage` | SILO lifecycle, bucket and anonymous read policy | node | no |
| `./commands` | `createDevCommands()` | node | no |
| `./bin/proxy` | Executable entry (bun shebang) | bun | no |

`package.json#exports` and `tests/exports.test.ts` are locked together; adding or removing an entry is a public contract change.

### 5.3 Dependencies

| Dependency | Form | Reason |
|---|---|---|
| `commander` | dependency | Required by the CLI entry; version controlled by devkit |
| `aws4fetch` | dependency | Bucket policy signing, small |
| `pg` | optional peer | Downstream already has a version; needed by `./proxy` and migrations |
| `drizzle-orm` | optional peer | Migrator API is tied to the downstream version |
| `typescript` / `vitest` / `tsdown` | devDependency | Never leaks downstream |

- `engines`: `node >= 22.22` (matching ymmt); `./proxy` additionally requires Bun `>= 1.4.4`.
- No `dotenv`: the env parser exists and must preserve comments and line order.
- Downstream pins an exact version (`"@chilfish/devkit": "0.1.0"`); upgrades go through separate PRs.

## 6. Public API

### 6.1 Configuration

```ts
import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: {
    name: 'ymmt',
    description: 'Yumemita data pipeline',
    helpHint: 'bun run ymmt',
    jsonEnvVar: 'YMMT_JSON',
  },
  env: {
    file: '.dev.vars',
    localFlag: 'LOCAL',
    onlineSuffix: '_ONLINE',
  },
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
    servers: [
      { name: 'astro', runtime: 'node', command: 'astro', args: ['dev'] },
    ],
  },
})
```

Field constraints:

| Field | Required | Default | Notes |
|---|---|---|---|
| `identity.name` | yes | — | CLI name; prefix of `command` in envelopes |
| `identity.description` | yes | — | Root command description |
| `identity.helpHint` | no | `bun run <name>` | Next step in error hints |
| `identity.jsonEnvVar` | no | — | Implicit JSON switch |
| `env.file` | yes | — | Env file relative to the repository root |
| `env.localFlag` | no | `LOCAL` | Master switch variable |
| `env.onlineSuffix` | no | `_ONLINE` | Remote-target suffix; omit expansion when unset |
| `database.localUrl` | yes | — | Database URL when local |
| `database.proxyEndpoint` | yes | — | `/sql` proxy endpoint |
| `database.migrations` | yes | — | Drizzle migrations directory |
| `storage.bucket` | no | — | Local bucket |
| `storage.dataDir` | no | `temp/silo-data` | SILO data directory |
| `storage.publicBaseEnv` | no | — | Variable receiving the derived media base in local mode |
| `paths.logs` | no | `logs` | Background service log directory |
| `dev.servers` | yes | — | At least one; see 6.6 |

`defineDevkit` only validates and freezes: no file reads, no `process.env` writes, no output.

### 6.2 CLI

```ts
import { buildCli, runCli } from '@chilfish/devkit/cli'

const program = buildCli({
  config: devkit,
  version,
  groups,
  rootCommands,
})
await runCli(program, process.argv.slice(2))
```

- `CommandSpec` / `CommandGroup` / `CommandContext` keep the existing shape; `toArgv`, `requireString`, `integer` and `flag` stay.
- The runtime owns help output, global options, logger, environment banner, JSON envelope, exit codes and the `describe` subcommand.
- Project name, hints and the implicit JSON variable come from `config`; the runtime imports no project files.

### 6.3 Environment

```ts
import { loadEnvFile, describeEnvironment } from '@chilfish/devkit/env'
import { isLocalMode, isLocalUrl } from '@chilfish/devkit/shared'

loadEnvFile({ config: devkit })
const banner = describeEnvironment(process.env, devkit)
```

Behavior:

1. Read `env.file`; only fill keys missing from the process environment. Explicit variables always win.
2. `LOCAL` precedence: process environment > file.
3. `LOCAL=1`: ignore `*_ONLINE`, force `DATABASE_URL` / `NEON_HTTP_ENDPOINT` at local values, write `storage.publicBaseEnv` when configured.
4. `LOCAL=0`: expand `*_ONLINE` into base keys, process environment still wins; if `DATABASE_URL` points at localhost, clear it and warn.
5. The banner prints only mode, database host/name and local bucket address; never credentials.

`isLocalUrl` recognizes `localhost` / `127.0.0.1` / `[::1]`; no fuzzy matching.

### 6.4 Local database

```ts
import { ensureDevServices } from '@chilfish/devkit/local'
const { databaseUrl, endpoint } = await ensureDevServices({ config: devkit })
```

Also exported individually:

- `resolvePostgresInstall()`: `PG_CTL` → `PATH` → Scoop → install directories; `PGDATA` wins.
- `ensurePostgresRunning()`: reuse a running instance; attach the log tail on failure.
- `ensureDatabase()`: create the database after a name whitelist check.
- `applyMigrations()`: uses `config.database.migrations`.
- `ensureEnvFile()`: touches only declared keys, preserving comments, blank lines and other lines (including `*_ONLINE`).

### 6.5 Proxy

```ts
import { createProxyHandler } from '@chilfish/devkit/proxy'
```

- `createProxyHandler({ databaseUrl })`: pure handler, easy to start in-process and test.
- `startProxy({ databaseUrl, port })`: `Bun.serve` wrapper returning `{ url, close }`.
- Background entry `./bin/proxy`: reads `DATABASE_URL` / port and is spawned by the local orchestrator using an **absolute in-package path**.
- Accepts only local database URLs; `/health` returns pid, host, database and query counters.

### 6.6 dev command group

```ts
import { createDevCommands } from '@chilfish/devkit/commands'

const devGroup = createDevCommands(devkit)
```

Produces `dev db` / `dev proxy` / `dev storage` / `dev server`:

- `dev server` starts every `dev.servers` process and forwards signals and exit codes; arguments after `--` go to the **first** server (multi-target passthrough is an open question).
- `dev proxy` runs in the foreground; `dev db` and `dev storage` only prepare their service.
- Global `--dry-run` reports steps for all four commands without starting processes or writing files.

### 6.7 Storage

```ts
import { ensureSiloRunning, ensureLocalBucket } from '@chilfish/devkit/storage'
```

- Binary lookup: `SILO_BIN` → `PATH` → Scoop → `minio` fallback.
- Startup arguments, data directory and console port come from configuration and the environment; logs go to `paths.logs`.
- Bucket and anonymous read policy are signed with `aws4fetch`; credentials are passed by the caller, devkit does not interpret R2 semantics.

## 7. Runtime boundaries

- Only `.` and `./shared` are neutral; all other entries declare `platform: 'node'`, with `./proxy` and `./bin/proxy` marked Bun-only.
- `tests/` adds a "browser target build" case: build `./shared` with `bun build --target=browser` and assert no `node:` / `bun:` builtins.
- Downstreams forbid new Worker imports through ESLint `no-restricted-imports` for `@chilfish/devkit/{cli,env,local,proxy,storage,commands}`; the integration guide provides a copy-pasteable snippet.
- Migration exception: `astro.config.mjs` may import `./shared` and `./env` (build time, not bundled into Workers).

## 8. Behavior contracts

| Item | Contract |
|---|---|
| Exit codes | `0` success / converged; `1` runtime failure (partial failure included); `2` usage error; `3` missing configuration |
| stdout | Command data and the `--json` envelope only; logs, banners and help go to stderr |
| `--json` | One-line envelope `{ ok, command, data, error, meta }`; `meta.mode` is `local` / `remote` |
| `--dry-run` | No database, object-storage or file writes; no processes |
| Banner | One line before every command: mode · database host/name · local bucket address |
| Background services | Postgres / proxy / SILO survive the foreground command; repeated runs health-check and reuse; a port held by another database is an error |
| Log files | Named per service under `paths.logs`; NDJSON only with explicit `--log-file` |
| Errors | Stable `code` + `message` + `hint` (copy-pasteable next step) + `context`; stack traces only at `debug` |

## 9. Module reuse map

| devkit module | Reused from | Parameterize | Notes |
|---|---|---|---|
| `cli/runtime` | ymmt `scripts/lib/cli/runtime.ts` | name, hints, JSON variable, env loading | Merge tweets' `describeError` (cause expansion) |
| `cli/envelope` / `exit` / `logger` | ymmt files of the same name | none | Direct move |
| `env/load` | ymmt `scripts/lib/env.ts` | file, suffix, derived keys | Merge tweets' `applyLocalDefaults` and multi-database parsing (optional) |
| `env/online` | ymmt `scripts/lib/online-env.ts` | suffix | Expansion and restore only; no project credentials |
| `env/mode` | ymmt `local-config.ts` + tweets `shared` | local defaults | Pure functions; remove `process.env` defaults |
| `local/postgres` | ymmt `dev-services.ts` | log directory | Keep discovery logic as-is |
| `local/database` | same | migrations directory | Create database + drizzle migrate |
| `local/envfile` | ymmt `ensureDevVars` + tweets `ensureLocalEnv` | filename and keys | Keep the "never overwrite existing values" semantics |
| `local/proxy` | ymmt `commands/dev/proxy.ts` | in-package entry path | Fix the stale script path |
| `storage` | ymmt `dev-silo.ts` | bucket, directory, port | Credentials passed by the caller |
| `commands/dev` | ymmt `commands/dev/*` | `dev.servers` | Multiple processes (tweets server + client) |

**Not reused**: fetch/ingest/publish/validate, remote R2 resolution, framework config, deploy and smoke commands.

## 10. Migration stages

The downstream must remain runnable at every stage; two implementations must not coexist for long.

### S0 Downstream stopgap and interface freeze (in ymmt)

- S0-1 Fix the proxy entry: extract the proxy body into a reusable function, shared by the command and the orchestrator; `ensureDevProxy` spawns an absolute path.
- S0-2 Add `scripts/dev.config.ts` and converge the constants from §3; runtime / env / local read from config.

**Acceptance**

- After stopping the proxy on 4444, `bun run dev` starts it; `curl http://127.0.0.1:4444/health` reports `ymmt_dev`; pages read the database.
- `git grep "scripts/dev-db-proxy.ts" -- scripts/` returns nothing.
- `bun run check` passes; `bun run ymmt describe --json` is structurally unchanged (version may differ).

### S1 Build the package and publish 0.1.0 (this repository)

- Rename package and repository metadata; create entries and directories per §5; move the modules from §9.
- Add unit and contract tests; record the first usable version in `CHANGELOG`.
- Publish `@chilfish/devkit@0.1.0`.

**Acceptance**

- `bun run check` passes; `bun run test:coverage` covers config, env precedence, env-file writes, exit codes and the entry matrix.
- `bun pm pack --dry-run` contains only `dist/`, `README.md`, `LICENSE.md`, `package.json`.
- A temporary fixture installing the tarball supports `--help`, `describe --json` and `dev --help`; the proxy answers `select 1`; `/health` returns the target database.

### S2 Switch ymmt

- Delete the local copy, depend on `@chilfish/devkit`; keep `scripts/dev.config.ts` and business commands.

**Acceptance**

- `git grep` finds no local `buildEnvelope` / `CommandSpec` / `ensureSiloRunning`.
- `bun run check` and `bun run build` pass.
- `bun run ymmt describe --json` matches the S0 snapshot field by field (except version).
- Starting from "Postgres running, proxy stopped", `bun run dev` brings up the full stack and pages return 200.
- `bun run ymmt db verify` and `bun run ymmt validate data` pass.

### S3 Switch tweets

- Delete the duplicate CLI / dev-services / dev-storage / local-config code; the `dev` group uses devkit.
- Recover unique capabilities such as `describeError` and multi-database parsing into devkit without changing ymmt behavior.

**Acceptance**

- `bun run ig ins verify <account> --json | jq .meta.mode` returns `local`.
- `bun run dev` starts server and client together; `/v3/users/all` matches the local import count.
- `bun run test` passes; the two repositories share no infrastructure filenames.

### S4 Documentation convergence

- Add the parameterized guides and config reference to this repository (§12).
- Shrink downstream `local-database.md` to a differences page (≤ 120 lines); `cli.md` keeps only the project command tree and links.

**Acceptance**

- `bun run check:docs` passes; paths and commands in the guides are executable.
- Downstream docs no longer copy conceptual sections such as "why the proxy exists"; each fact exists once.
- Following the guide, a fixture integrates from scratch without reading downstream source.

### S5 Scaffolding (optional)

- Trigger: a third project, or the same manual steps repeated three times.
- Shape: `devkit init` or a standalone starter reusing this release chain, generating `dev.config.ts` and doc skeletons.
- Not implemented before the trigger.

## 11. Test strategy

| Layer | Coverage | Trigger |
|---|---|---|
| Unit | Config validation, env precedence matrix (process/file/`LOCAL`), `*_ONLINE` expansion and restore, env-file order preservation, URL checks, banner redaction, envelope and exit codes, help text | Every `bun run check` |
| Integration | Temporary database creation + migration, proxy single/batch query, `/health`, port conflict detection; SILO optional | `DEVKIT_PG_SMOKE=1`; CI with a Postgres service |
| Contract | Entry matrix shape, `./shared` browser-target build, `package.json#exports` locked with tests | Every CI run |
| Downstream smoke | Both downstreams' `check` / `build` / local chain | Before release; PRs upgrading peers |

Any bug fix starts with a failing reproduction case.

## 12. Documentation strategy

Repository docs (S4 completes them; until then the code wins):

| Document | Content |
|---|---|
| `docs/guide/getting-started.md` | Install, write config, wire up the CLI, wire up dev commands |
| `docs/guide/local-dev.md` | Postgres / proxy / SILO: behavior, operations, stop and reset |
| `docs/guide/cli.md` | `CommandSpec`, `--json`, exit codes, logs, `describe` |
| `docs/reference/config.md` | Config fields, defaults, validation rules |
| `docs/reference/api.md` | Exports of the eight entries |
| `docs/reference/commands.md` | Built-in `dev` commands and options |
| `docs/engineering/architecture.md` | Layers, entry matrix, runtime boundaries |
| `docs/engineering/dependencies.md` | Peer strategy and upgrade flow |
| `docs/engineering/testing.md` | Three test layers and fixture method |

Downstream template (a differences page with four fixed sections):

1. Project parameters: database, bucket, migrations directory, env file, dev servers.
2. Start/stop/reset: only what differs from the general flow.
3. Project-specific symptoms: only issues that cannot occur elsewhere.
4. Links: concepts, general troubleshooting and command reference all point at devkit.

Never copy the body of the parameterized guides into downstream docs; delete the project-side copy and keep a link.

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Peer drift (`pg` / `drizzle-orm`) | Downstream upgrades block each other | Optional peers + version ranges; run both downstream `check`s before release |
| Bun-only proxy | Node script projects cannot use it | Document it; Node support is an open question |
| Windows background processes (`cmd start`, fd inheritance) | Proxy / SILO fail to start | Keep the existing implementation; print the log tail; integration smoke covers "auto-start when not running" |
| Dual sources during migration | Fix one, miss the other | Delete local copies immediately after S2/S3; no temporary retention |
| Env semantic differences (`.dev.vars` + `*_ONLINE` vs `.env` + `DATABASE_URL_REMOTE`) | Forcing unification breaks downstreams | Parameterize; decide after a third project |
| Over-abstraction | Heavy package, unstable API | Reuse only capabilities seen twice; new capabilities start with a design and a downstream use case |
| Docs drift again | Two guides | Downstream keeps differences only; review checks for copied conceptual sections |

## 14. Open questions

1. Does `./proxy` need Node support (`node:http`)? Trigger: a non-Bun script project.
2. Should `*_ONLINE` and `DATABASE_URL_REMOTE` be unified? Leaning no, wait for a third consumer.
3. Should remote object-storage resolution (R2 credentials, CDN prefix) enter the package? Semantics differ; not yet.
4. Passthrough semantics for multiple `dev server` processes: is `--target <name>` needed?
5. Should `devkit doctor` exist (pg / silo / port / env-file consistency)? Leaning 0.2.
6. Split threshold for the single package: about 2500 source lines, two runtimes, or a third consumer.
7. `devkit init` versus a standalone starter: decide at S5.

## 15. Definition of done

- No downstream project contains duplicated local infrastructure; each config stays under about 40 lines.
- Both downstream `check` / `build` / local chain pass.
- Entry matrix, env precedence and exit codes have tests that can fail.
- A new project can integrate from the guide without reading downstream implementations.
- `docs/README.md` is complete and `bun run check:docs` passes.
- `CHANGELOG` records 0.1.0 capability boundaries and known limitations.
