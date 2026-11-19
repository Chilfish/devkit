# Local development

The local stack is split into independent background services:

| Service | Entry | Lifecycle |
|---|---|---|
| Postgres | `ensurePostgresRunning` | Background; survives the dev server |
| `/sql` proxy | `ensureDevProxy` + `./bin/proxy` | Background; reused after a health check |
| SILO | `ensureSiloRunning` | Background; optional |

`ensureDevServices` runs the whole chain: Postgres → database → migrations → env file → proxy → SILO.

## Why the proxy exists

workerd (astro dev / preview) cannot open TCP connections, and `@neondatabase/serverless` only speaks Neon's HTTP `/sql` protocol. The proxy translates:

- `POST /sql` with `{ query, params }` or `{ queries: [...] }`
- `GET /health` with pid, host, database and counters

Only local database URLs are accepted, so a remote database is never exposed on localhost.

The background entry is resolved by absolute path inside the package, never from `cwd` or the host project's scripts.

## Environment layering

`loadEnvFile` applies this order:

1. Process environment wins over the file.
2. The local flag resolves as process environment > file.
3. Local mode: ignore `<KEY>_ONLINE`, force `DATABASE_URL` and `NEON_HTTP_ENDPOINT` to local values, derive the public media base.
4. Remote mode: expand `<KEY><suffix>` into `<KEY>`; if `DATABASE_URL` still points at localhost, clear it and warn.

`ensureEnvFile({ preserveRemote: true })` saves a previous non-local `DATABASE_URL` as `DATABASE_URL<suffix>` before switching the file to local values.

The banner prints mode, database host/name and storage address only. It never prints credentials.

## Switching one process to the remote target

`loadEnvFile` handles `*_ONLINE` at startup. When a long-running command must
re-target a single process (publish/sync style work), use:

```ts
import { applyOnlineEnv, readOnlineTarget } from '@chilfish/devkit/env'

const target = readOnlineTarget({ config })
const restore = applyOnlineEnv({ config, remote: target.remote })
try {
  await publishTo(target.databaseUrl)
}
finally {
  restore()
}
```

`readOnlineTarget` reads the env file only, refuses a local remote URL and
reports missing keys with exit code 1. `applyOnlineEnv` expands
`<KEY><suffix>`, sets the local flag to `0`, clears local-only endpoints
(`NEON_HTTP_ENDPOINT`, `S3_ENDPOINT`, `MINIO_*`, `SILO_*`) and restores the
previous process state when the returned function is called.

## Postgres discovery

`resolvePostgresInstall` looks for `pg_ctl` in this order: `PG_CTL` → `PATH` → Scoop → standard install directories. `PGDATA` always wins for the data directory.

If startup fails, the tail of `paths.logs/postgres.log` is attached to the error.

## Storage (SILO)

- Binary lookup: `SILO_BIN` → `PATH` → Scoop → MinIO fallback.
- Data directory: `SILO_DATA` → `storage.dataDir`.
- Endpoint: `S3_ENDPOINT` / `MINIO_ENDPOINT`, default `http://127.0.0.1:9000`.
- Bucket: `R2_BUCKET` → `storage.bucket` → `devkit-local`.
- Credentials: `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` → `MINIO_ROOT_*` → `silo-admin`.

On startup the bucket is created and made anonymously readable, so browsers can fetch media directly. A missing binary does not block the database stack: `dev server` warns and continues.

## Stop and reset

Background services are not children of the dev server, so closing the terminal leaves them running:

```bash
# proxy
curl http://127.0.0.1:4444/health

# Postgres
pg_ctl status -D <data dir>
pg_ctl stop -D <data dir>

# full reset of local data
rm -rf temp/silo-data
dropdb ymmt_dev
```

## Port conflicts

If the proxy port is healthy but connected to a different database, devkit fails with both targets instead of silently reusing it. Change the endpoint or stop the other proxy.
