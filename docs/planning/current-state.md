# Current state: duplicated and diverged local infrastructure

> Audit date: 2026-11-19. Targets: `yumemita-stream-dashboard` (ymmt), `tweets-viewer` (tweets), and this repository's starting point (a clean copy of `starter-ts-lib`).
> This document records facts and measurements only; the plan is in [devkit-design.md](./devkit-design.md).

## Conclusions

1. Both projects share the same local infrastructure: CLI runtime, local Postgres orchestration, Neon HTTP `/sql` proxy, SILO (S3) orchestration and the `LOCAL` environment switch. The reusable implementation is roughly **1.8k lines**.
2. The code has already diverged: `cli/runtime.ts` has 240 changed lines, `dev-services.ts` 265 and `local-config.ts` 192. Most of it is formatting; functional differences are concentrated in a few places (§2).
3. The divergence is mostly **project constants**, not logic: database name, migrations directory, env filename, log directory, bucket, media base variable and dev server command. All of it can be injected through one config (§3).
4. The copy model already produced one real regression: a stale proxy script path (§4). Human synchronization cannot prevent this class of bug.

## 1. Duplication

Measured with `Compare-Object` and `git diff --no-index` (2026-11-19). Changed lines = additions + deletions.

| File | ymmt | tweets | Changed | Nature |
|---|---:|---:|---:|---|
| `cli/runtime.ts` | 536 | 550 | 240 | Mostly formatting; functional differences in §2 |
| `cli/envelope.ts` | 52 | 56 | 8 | Formatting |
| `cli/exit.ts` | 74 | 76 | 10 | Formatting |
| `cli/logger.ts` | 102 | 125 | 79 | Formatting |
| `local-config.ts` | 81 | 167 | 192 | Semantic refactor (tweets moved it into `@tweets-viewer/shared`) |
| `dev-services.ts` | 418 | 441 | 265 | Constants + env file semantics |
| `dev-silo.ts` / `dev-storage.ts` | 210 | 237 | 145 | Constants + credential source |
| `commands/dev/proxy.ts` | ~150 | Separate implementation | — | ymmt moved the proxy into a command, tweets did not |

`dev-db-proxy.ts` was renamed (100% similarity) to `commands/dev/proxy.ts` in `02d45f7`, but the orchestrator was not updated (§4).

## 2. Functional divergence

| Capability | ymmt | tweets | Impact |
|---|---|---|---|
| `describe` subcommand | yes | yes | Same origin, not diverged |
| `CommandContext.toArgv` | yes | no | ymmt uses it to reuse old `main(argv)` |
| Error cause expansion | no | yes | ymmt's Drizzle errors only show the outer message |
| Implicit JSON switch | `YMMT_JSON=1` | no | Project name hardcoded |
| Env loading inside the runtime | yes | no (caller loads) | Different initialization order |
| Injectable `isLocalMode(env)` | yes | no; reads `process.env` | Testability differs |
| Unified local/remote storage | no (`object-storage.ts`) | `resolveStorage()` | Two separate R2 resolvers |
| Multiple database URLs | no | yes (comma-separated) | Only tweets needs it |
| Env file and remote targets | `.dev.vars` + `*_ONLINE` | `.env` + `DATABASE_URL_REMOTE` | Semantic difference; cannot be merged directly |

## 3. Coupling points that must be parameterized

| Coupling point | ymmt | tweets | Hardcoded in |
|---|---|---|---|
| CLI name / help hint | `ymmt` | `ig` | `cli/runtime.ts` |
| JSON env var | `YMMT_JSON` | none | `cli/runtime.ts` |
| Env file | `.dev.vars` | `.env` | `env.ts` / `dev-services.ts` |
| Local database | `ymmt_dev` | `tweets_dev` | `local-config.ts` / shared |
| Migrations | `drizzle` | `packages/database/migrations` | `dev-services.ts` |
| Log directory | `temp/` | `logs/` | `dev-services.ts` / `dev-silo.ts` |
| Local bucket | `yumemita-data` | `tweets-viewer` | `local-config.ts` |
| SILO data directory | `temp/silo-data` | `cache/silo-data` | `dev-silo.ts` / `dev-storage.ts` |
| Media base | `PUBLIC_R2_BASE` | `IG_CDN_BASE` | `env.ts` / `local-config.ts` |
| Dev servers | `astro dev` (Node) | server + client | `commands/dev/server.ts` / `dev-setup.ts` |

## 4. Defect: stale proxy entry path

`yumemita-stream-dashboard/scripts/lib/dev-services.ts:332`:

```ts
const script = resolve('scripts/dev-db-proxy.ts')
```

The file was renamed to `scripts/commands/dev/proxy.ts` in `02d45f7`, while the orchestrator still spawns the old path. When no proxy is running, `bun run dev` starts a nonexistent entry, polls `/health` for about ten seconds and exits with "development proxy failed to start".

- Reproduction: stop the proxy on port 4444 → `bun run dev`.
- Verification status: static inspection only (the file is missing, the reference remains, the rename commit is 100% similar); not executed to avoid interrupting running background services.
- Conclusion: the extracted package must resolve the proxy entry by absolute path inside the package, never from `cwd` or the project's script layout.

## 5. What to reuse

**Reuse** (present in both projects, logic independent of the project):

- CLI runtime: parsing, help, JSON envelope, exit codes, logger, environment banner
- Local Postgres: locate `pg_ctl` / `PGDATA`, start/stop, create database, migrate, `/health` reuse
- Neon `/sql` proxy: queries, batch queries, health check, local-only guard
- SILO: binary lookup, startup, bucket creation, anonymous read policy, log tail
- Env layer: file parsing, `LOCAL`, `*_ONLINE` expansion, local URL checks, environment description
- Dev command group: `dev db` / `dev proxy` / `dev storage` / `dev server`

**Do not reuse** (project-specific or not yet converged):

- Data pipelines: fetch, ingest, publish, validate, one-off patches
- Remote object-storage resolution (R2 credentials, CDN prefixes)
- Framework wiring: `astro.config.mjs`, `vite.config.ts`, `env.server.ts`
- Deploy, smoke and performance commands
- Test data and fixtures

## 6. Audit method

```bash
# line counts
(Get-Content <a>).Count
# diffs
git diff --no-index --stat -- <ymmt> <tweets>
git diff --no-index -U0 -- <a> <b>
# path references
git log --oneline --all --diff-filter=D -- scripts/dev-db-proxy.ts
git show --summary 02d45f7 | Select-String proxy
```

## 7. Not verified

- The proxy path regression was verified statically, not reproduced at runtime.
- tweets' SILO and `IG_CDN_BASE` local rewrite were checked in code and docs only; the full local stack was not started.
