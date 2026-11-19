# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## Unreleased

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
