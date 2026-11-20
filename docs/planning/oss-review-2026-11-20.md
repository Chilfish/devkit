# OSS review 2026-11-20

> Status: implemented (2026-11-20). Scope: source, tests, CI, docs, packaging and Neon protocol compatibility.
> This document records findings and the execution backlog. When the document and code disagree, the code wins and this document is fixed in the same change.
> Follow-up work (not in this change): `dev stop` with pid files and an ownership check.

## Method

- Read all 20 source files, 21 test files, every document and the package manifest.
- Ran `bun run typecheck`, `bun run lint:check`, `bun run test:coverage`, `bun run build` and `bun run verify:package` locally.
- Inspected `@neondatabase/serverless@1.0.2` (`index.mjs`) to compare the HTTP request/response contract with the proxy.
- Compared positioning with container-based local stacks, toolchain managers, runtime emulators and migration tools.

## Measurements

| Metric | Value | Note |
|---|---|---|
| Commits | 22 | all dated 2026-11-19; `0.1.0` → `0.1.4` in one day |
| Source | 2,844 lines / 20 files | 9 public entries plus `./bin/proxy` |
| Tests | 1,854 lines / 21 files | 148 passed, 7 skipped (integration) |
| Docs | 1,388 lines | 26 files |
| Coverage | 61.55% statements / 56.8% branches / 61.74% functions / 62.32% lines | no thresholds configured |
| Dist | 231.7 KB / 56 files | ESM + CJS + declarations |
| Runtime dependencies | 2 (`commander`, `aws4fetch`) | `pg` / `drizzle-orm` optional peers |

## Verdict

Engineering hygiene is above average for a personal library: strict TypeScript, no `any`, no TODOs, a clean multi-entry build, a serious CLI contract and a complete release pipeline.

The two central product claims are not yet backed by evidence:

1. **"Neon-compatible `/sql` proxy"** is only verified against the proxy's own handler, not against the official driver, and the batch/error semantics diverge.
2. **"Verifiable local stack"** cannot be verified by CI: integration tests are always skipped, and the Windows-only process code never runs in CI.

As a public package it behaves like a private tool with public packaging. The gap is verifiability and scope definition, not code style.

## Findings

### R-01 (P0) Proxy batch semantics differ from Neon

`src/proxy/index.ts` runs `{ queries: [...] }` as independent `pool.query` calls. It does not acquire one client, does not open a transaction and ignores `Neon-Batch-Isolation-Level`, `Neon-Batch-Read-Only` and `Neon-Batch-Deferrable`.

The official driver sends those headers for `transaction()`; its contract is a single transaction. Through this proxy, a failing second statement leaves the first committed and `SET` / temporary-table state is not preserved.

### R-02 (P0) Proxy drops PostgreSQL error fields

The proxy returns `{ message }` on failure. The driver reads `message` plus `severity`, `code`, `detail`, `hint`, `position`, `internalPosition`, `internalQuery`, `where`, `schema`, `table`, `column`, `dataType`, `constraint`, `file`, `line`, `routine`. Downstream code that branches on SQLSTATE (for example `23505`) cannot work.

### R-03 (P0) Proxy compatibility is untested against the real driver

`tests/integration/postgres.test.ts` exercises `createProxyHandler` directly. No test starts the proxy and talks to it with `neon()` / `query()` / `transaction()`.

### R-04 (P0) CI cannot see the risky code

- `.github/workflows/ci.yml` only runs `ubuntu-latest`; the Windows-specific branches (`where`, Scoop lookup, `.cmd` / `.exe` shims, `cmd /c start`, detached processes) are never executed.
- Integration tests require `DEVKIT_PG_SMOKE=1`; CI never sets it and provides no Postgres service, contradicting `docs/engineering/testing.md` and `devkit-design.md` §11.
- Coverage has no thresholds while `docs/engineering/testing.md` describes thresholds as a ratchet.

### R-05 (P1) Positioning overlaps with solved problems

The package orchestrates system-installed Postgres and SILO (including `C:\Scoop`, `/opt/homebrew`, Program Files discovery). Container-based peers (`supabase` CLI, `docker compose`) are more reproducible; toolchain managers (`mise`, `devbox`) own version pinning; `wrangler` owns the local runtime.

The genuinely unique parts are the Neon `/sql` bridge and the environment precedence layer. The rest re-implements process supervision.

SILO is a MinIO fork maintained outside this repository, yet it is a runtime dependency of the public package.

### R-06 (P1) No lifecycle beyond start

There was no `status` or `stop`. Background services survive the terminal; stopping them requires `pg_ctl`, `taskkill` or Task Manager.

Resolved in part: `dev status` now reports Postgres, proxy and SILO state. `stop` was deliberately not implemented: devkit does not own the Postgres instance (stopping it would affect unrelated projects) and SILO exposes no pid. See "Rejected in this change".

### R-07 (P1) Project root is `process.cwd()`

`resolveCommand` / `resolvePackageBin` resolve `node_modules/.bin` from the current directory. Running the CLI from a subdirectory silently loses local binaries.

### R-08 (P1) Windows shim spawning uses `shell: true` with arguments

`.cmd` / `.bat` shims are spawned with `shell: true` and an argument array, which Node flags with `DEP0190`. Forwarded `--` arguments are not escaped before reaching `cmd.exe`.

### R-09 (P1) Detached spawn is duplicated

`src/local/proxy.ts` and `src/storage/index.ts` each implement the Windows `cmd /c start` / POSIX detached spawn, including log-file descriptors and `unref()`.

### R-10 (P1) `readLogTail` reads the whole file

Failure paths (`Postgres failed to start`, proxy timeout, SILO timeout) load the entire log into memory before taking the last 10 lines.

### R-11 (P1) `dev server --json` breaks the envelope contract

Child processes use `stdio: 'inherit'`, so their stdout is interleaved with the single-line JSON envelope.

### R-12 (P1) `describe` bypasses the runner

`describe` writes JSON directly from a commander action. It ignores `--json`, produces no envelope or `meta`, and is the only command that does not pass through the runtime. Documentation claims every command accepts the global options.

### R-13 (P2) Configuration is monolithic

`defineDevkit` requires `dev.servers` with at least one entry, so a project that only wants `./env` or `./proxy` still has to configure dev servers. Full decoupling of `database` / `storage` is a larger API change and is tracked separately.

### R-14 (P2) Environment parser edge cases

- `upsertEnvValues` joins with `\n`, rewriting CRLF files to LF on a Windows-first tool.
- Inline comments after quoted values are preserved (`KEY="x" # note` becomes `"x" # note`).
- Key matching uses `\w+`, so `.` and `-` keys are skipped.

### R-15 (P2) Packaging and entry matrix

- 9 entries for 2.8k lines; `./commands` exports four functions.
- `tsdown.config.ts` labels `./proxy` as `platform: 'neutral'` although it requires `Bun.serve` and imports `pg`.
- Adding an entry requires editing tsdown, `package.json#exports`, `tests/exports.test.ts`, `scripts/verify-package.mjs`, the API reference and the CHANGELOG.
- No `bin` field; the proxy can only be spawned internally.

### R-16 (P2) Release cadence and document drift

- Four patch releases in one day before any downstream integration.
- Planning documents reference private repositories (`ymmt`, `tweets-viewer`) in a public repository.
- Drift found: CI-with-Postgres claim, every-command-accepts-globals claim, coverage-threshold claim.

## Execution backlog

Status values: `done`, `in progress`, `backlog`.

| ID | Priority | Change | Status | Acceptance |
|---|---|---|---|---|
| R-01 | P0 | Run Neon batches on one client inside `BEGIN` / `COMMIT`, honor batch headers | done | unit tests assert `BEGIN`/`COMMIT`/`ROLLBACK` and isolation clauses; integration test proves `transaction()` rollback |
| R-02 | P0 | Return PostgreSQL error fields on HTTP 400 | done | unit test maps `code` / `detail` / `constraint`; integration test sees `23505` |
| R-03 | P0 | Add `@neondatabase/serverless` integration test | done | `neon().query`, `transaction()` and unique-violation code run against a real database when `DEVKIT_PG_SMOKE=1` |
| R-04 | P0 | CI: Postgres integration job, Windows job, coverage thresholds | done | both jobs pass; `test:coverage` fails below the thresholds |
| R-05 | P1 | Record scope decision; keep containerization out of scope | done (documented) | this document states the boundary |
| R-06 | P1 | Add `dev status`; document why `stop` is deferred | done | `dev status --json` returns deterministic output in remote mode |
| R-07 | P1 | Resolve servers from the nearest project root | done | test runs from a nested directory and finds the root `node_modules` |
| R-08 | P1 | Build a quoted command line and spawn `cmd.exe` without `shell: true` | done | no `DEP0190` at runtime; metacharacters in forwarded args stay quoted |
| R-09 | P1 | Extract one detached spawn helper | done | proxy and SILO use the helper; Windows path unit-tested |
| R-10 | P1 | Read only the tail window of a log file | done | test with a log larger than the window returns the last lines |
| R-11 | P1 | Route child stdout to stderr in JSON mode | done | `dev server --json` keeps one envelope line on stdout |
| R-12 | P1 | Register `describe` as a normal command | done | `describe` keeps human output; `describe --json` returns an envelope |
| R-13 | P2 | Make `dev.servers` optional | done | config without `dev` is valid; `dev server` reports `NO_DEV_SERVERS` |
| R-14 | P2 | Preserve EOL, parse inline comments, allow `.` / `-` keys | done | unit tests cover CRLF, quoted-with-comment and dotted keys |
| R-15 | P2 | Fix proxy platform label; derive package verification from `exports` | done | build passes; `verify:package` no longer duplicates the entry list |
| R-16 | P2 | Sync docs and CHANGELOG with the changes | done | `check:docs` passes; CHANGELOG lists added/changed/fixed |

## Peer comparison

| Dimension | devkit | Common peer behavior |
|---|---|---|
| Reproducibility | system-installed Postgres / SILO | containers or pinned toolchains |
| Lifecycle | `start` (+ `status` after this change) | `start` / `stop` / `status` / `reset` |
| Cross-platform | many Windows branches, Linux-only CI | three-OS CI matrix |
| CLI contract | envelope, exit codes, contract tests | rare in small tools |
| Proxy compatibility | hand-written protocol; now driver-tested | reuse the official driver or local runtime |
| Release | OIDC provenance, dependabot | rare in small tools |

## Rejected in this change

- **`dev stop`**: devkit starts the system Postgres but does not own it; stopping it would break unrelated projects. SILO runs detached and exposes no pid. A safe `stop` needs pid files written at spawn time, an ownership check and an explicit `--force` path. Tracked as follow-up with acceptance: only services spawned by devkit are stopped; a shared Postgres is never stopped.
- **Containerizing the stack**: a different product. Keep the current contract and revisit only if a third consumer cannot install Postgres locally.
- **Clearing `S3_*` credentials in `applyOnlineEnv`**: their semantics depend on the host (R2 versus local MinIO). The current fixed list only clears endpoints and SILO/MinIO variables; hosts remain responsible for credentials.
- **Splitting `defineDevkit` into per-entry configs**: a public API redesign; only `dev` becomes optional here.

## Verification

```bash
bun run typecheck
bun run lint:check
bun run test:coverage
bun run build
bun run verify:package
bun run check:docs

# integration (requires a reachable Postgres)
DEVKIT_PG_SMOKE=1 DEVKIT_PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres bun run test:integration
```
