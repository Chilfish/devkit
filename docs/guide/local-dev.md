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

Batch requests run on one pooled connection inside `BEGIN` / `COMMIT`, honoring `Neon-Batch-Isolation-Level`, `Neon-Batch-Read-Only` and `Neon-Batch-Deferrable`, so the driver's `transaction()` stays atomic. A failing statement rolls the whole batch back.

PostgreSQL error fields (`code`, `severity`, `detail`, `hint`, `constraint`, ...) are returned in the HTTP 400 body, so callers can keep branching on SQLSTATE (for example `23505`).

Only local database URLs are accepted, so a remote database is never exposed on localhost.

The background entry is resolved by absolute path inside the package, never from `cwd` or the host project's scripts.

## Status

`dev status` reports Postgres reachability, proxy health and SILO health without starting anything. It never stops services: devkit does not own the system Postgres instance.

## Environment layering

`loadEnvFile` applies this order:

1. Process environment wins over every file.
2. The local flag resolves as process environment > base file.
3. Load the base `env.file`, then the mode file: `<file>.dev` when the flag is on, `<file>.prod` when it is off. A missing mode file is skipped and later files override earlier ones.
4. Local mode: force `DATABASE_URL` and `NEON_HTTP_ENDPOINT` to local values, derive the public media base.
5. Remote mode: if `DATABASE_URL` still points at localhost, clear it and warn; the remote value belongs in `<file>.prod`.

`ensureEnvFile` writes the local addresses into `<file>.dev` when that file exists, otherwise into the base file. It never touches `<file>.prod`, so localhost addresses cannot leak into a deployment file.

The banner prints mode, database host/name and storage address only. It never prints credentials.

## One env file per environment

Each environment keeps its own file instead of suffixed keys:

```text
.env          # shared defaults, committed
.env.dev      # local database, storage and tokens, ignored
.env.prod     # deployment values, injected by the platform or ignored
```

Deployment needs no key rewriting: it sets `LOCAL=0` (or leaves it unset), and `<file>.prod` supplies the remote values under the same key names. Anything the platform injects into the process environment wins over both files.

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
