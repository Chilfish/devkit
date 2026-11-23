# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## Unreleased

### Added

- `./pipeline`: bounded-concurrency stage runner with a strict stage/item state machine, atomic JSON snapshots (`createFilePipelineStore`) and resumable runs. Stages run in-process or on `node:worker_threads` via `worker: { entry, export }`; per-item failures are aggregated instead of aborting the batch. See [docs/guide/pipeline.md](./docs/guide/pipeline.md).
- `dev status`: read-only report of Postgres reachability, proxy `/health` and SILO health. Down services are reported as `running: false`.
- `describe --json` now returns the command tree in the standard envelope (`data`, `error`, `meta`); human mode keeps the pretty JSON output.
- `createProxyHandler({ pool })` test seam, plus `parseBatchOptions` / `batchBeginStatement` exports from `./proxy`.
- `findProjectRoot` exported from `./commands`.
- Integration test that drives the official `@neondatabase/serverless` client against the background proxy entry.

### Changed

- `dev.servers` is optional and defaults to `[]`; `dev server` then fails with `NO_DEV_SERVERS` (exit 3) instead of rejecting the config.
- `dev server --json` routes child stdout to stderr, so stdout keeps exactly one envelope line.
- `resolveServerSpawn` resolves `node_modules` from the nearest package root instead of `process.cwd()`.
- Windows `.cmd` / `.bat` servers run through `cmd.exe /d /s /c` with quoted arguments instead of `shell: true`.
- Proxy and SILO background processes use one `spawnDetached` helper.
- CI adds a Postgres integration job and a Windows job; coverage thresholds (63 / 57 / 62 / 64) are enforced.
- `scripts/verify-package.mjs` derives artifact checks from `package.json#exports` and supports npm 12's `pack --json` shape.

### Fixed

- The proxy runs batch queries on one connection inside `BEGIN` / `COMMIT`, honors the Neon batch headers and rolls back on failure; `transaction()` is atomic again.
- Proxy HTTP 400 bodies now include PostgreSQL error fields (`code`, `severity`, `detail`, `hint`, `constraint`, ...), restoring SQLSTATE branching downstream.
- Windows background services wrote no output to `dev-proxy.log` / `silo.log` because `cmd /c start` dropped the inherited descriptor; direct detached spawn captures it and still survives the parent.
- `readLogTail` reads only the last 64 KB instead of the whole file.
- `upsertEnvValues` preserves CRLF; the env parser handles inline comments and dotted / dashed keys.
- `verify-package` no longer silently passes with an empty tarball file list under npm 12.

## 0.1.4

### Added

- `ensureEnvFile({ preserveRemote: true })` and `ensureDevServices({ preserveRemote: true })` keep a previous non-local `DATABASE_URL` as `DATABASE_URL<suffix>` before switching the file to local values.

### Fixed

- `ensureDevServices` now passes its `endpoint` override (and `NEON_HTTP_ENDPOINT`) through to `ensureDevProxy`; previously the proxy always used `config.database.proxyEndpoint`.
- `{ runtime: 'bun', command: 'bun' }` runs `bun <args>` instead of `bun bun <args>`; the same applies to `node`.
- `dev storage` without the local flag now reports `NOT_LOCAL_MODE` as a config error (exit code 3) instead of exit code 1.

## 0.1.3

### Fixed

- `dev server` resolves a server command through its package manifest (`node_modules/<command>/package.json` → `bin`) before using the `node_modules/.bin` shim. On Windows this avoids passing `astro.exe` / `.cmd` shims to `node` as a script.
- When no package entry exists, `.cmd` / `.bat` shims run directly through the shell and `.exe` shims run directly; the configured runtime is only prefixed to real scripts.
- Added `resolvePackageBin` and `resolveServerSpawn` (exported from `./commands`) with tests for string/object `bin`, Bun runtimes, explicit paths, missing packages and Windows shims.

## 0.1.2

### Fixed

- `resolveProxyEntry` now walks up from the calling module, so the published package finds `dist/bin/proxy.js`. Previously it looked one directory too high (`../bin/proxy.js` from a `dist/` chunk) and every path reaching `ensureDevProxy` failed with "Background proxy entry not found".
- Added `findProxyEntry`, exported from `./local`, plus regression tests for both the bundled `dist/` layout and the source layout.

## 0.1.1

### Added

- `./env`: `readOnlineTarget` and `applyOnlineEnv` for re-targeting a running process to the remote database/credentials and restoring it afterwards. Parameterized by `env.onlineSuffix`; no project credentials are interpreted.
- `./cli`: `requireEnv(name, message?)`, which throws a plain `Error` (exit code 1) for hosts that treat missing variables as runtime failures.
- `./cli`: `buildCli({ labels })` lets `describe` keep a host's existing exit-code and global-option wording.
- `./commands`: `createDevCommands(config, { serverLocalFlag, strings })` adds the downstream `--local` switch and allows description/details/examples/option-description overrides without changing command ids.
- `./local`: `ensureDevServices({ databaseUrl, endpoint })` overrides for benchmarks and ad-hoc scripts.

### Changed

- Built-in command examples derive from `identity.helpHint` instead of hardcoding `bun run dev`.
- CI actions bumped to `checkout@v7`, `setup-node@v7`, `upload-artifact@v7` and `download-artifact@v8`; docs and the pitfall checklist follow the new majors.

## 0.1.0

### Added

- `defineDevkit`: validated, deeply frozen configuration with identity, env, database, storage, paths and dev-server sections.
- `./shared`: pure URL checks, env content parsing, upsert that preserves line order, local address derivation.
- `./cli`: `CommandSpec` / `CommandGroup` / `CommandContext`, `buildCli`, `runCli`, `describeCli`, JSON envelope, fixed exit codes (0/1/2/3) and a stderr-only logger.
- `./env`: env file loading with process-environment precedence, `LOCAL` handling, `*_ONLINE` expansion and a credential-free banner.
- `./local`: Postgres discovery and startup, database creation, drizzle migrations, env-file sync, background `/sql` proxy management, and `ensureDevServices`.
- `./proxy`: Neon-compatible `/sql` handler plus `Bun.serve` wrapper; `/health` reports pid, host, database and counters.
- `./storage`: SILO / MinIO discovery and startup, bucket creation and anonymous read policy via `aws4fetch`.
- `./commands`: built-in `dev server`, `dev db`, `dev proxy` and `dev storage` commands driven by configuration.
- `./bin/proxy`: background proxy entry, resolved by absolute path inside the package.
- Runnable examples for the config, full CLI wiring, env loading, local stack and foreground proxy.
- Real-scenario tests: CLI end-to-end (help, `describe`, exit codes, envelopes), Postgres create + drizzle migration + proxy single/batch query, and background proxy start/reuse/conflict.

### Changed

- Package is published as `@chilfish/devkit` with eight typed subpath entries plus `./bin/proxy`.
- `engines.node` is now `>=22.22`.
- `commander` and `aws4fetch` are runtime dependencies; `pg` and `drizzle-orm` are optional peers.

### Known limitations

- The proxy is Bun-only (`Bun.serve`); Node support is an open question.
- `dev server` forwards `--` arguments to the first configured server only.
- Remote object-storage resolution (R2 credentials, CDN prefixes) stays in consuming projects.
