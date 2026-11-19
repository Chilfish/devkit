# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## Unreleased

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

### Changed

- Package is published as `@chilfish/devkit` with eight typed subpath entries plus `./bin/proxy`.
- `engines.node` is now `>=22.22`.
- `commander` and `aws4fetch` are runtime dependencies; `pg` and `drizzle-orm` are optional peers.

### Known limitations

- The proxy is Bun-only (`Bun.serve`); Node support is an open question.
- `dev server` forwards `--` arguments to the first configured server only.
- Remote object-storage resolution (R2 credentials, CDN prefixes) stays in consuming projects.
