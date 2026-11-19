# Built-in commands

`createDevCommands(config)` returns a `dev` group with four commands. Every command accepts the global options listed in [cli](../guide/cli.md).

## `dev server`

Brings up the local stack, then starts every configured server.

- Postgres, the proxy and SILO survive the dev server and are reused on the next run.
- `--` arguments are forwarded to the first configured server.
- Signals are forwarded to all servers; the first non-zero exit code becomes the command exit code.
- `--dry-run` reports the planned processes without starting anything.

```bash
bun run dev server
bun run dev server -- --port 4322
```

## `dev db`

1. Start Postgres (or reuse it).
2. Create the database if missing (name whitelist: `a-z`, `0-9`, `_`).
3. Apply drizzle migrations from `database.migrations`.
4. Sync the env file with `DATABASE_URL`, `NEON_HTTP_ENDPOINT`, the local flag and the public base.

Options: `--url <url>` overrides the configured local URL. `--dry-run` reports the steps only.

## `dev proxy`

Runs the Neon-compatible `/sql` proxy in the foreground. Only local `DATABASE_URL` values are accepted. Options: `--port <n>`; defaults to the port in `database.proxyEndpoint`.

`dev server` starts the same proxy on demand, so running this separately is optional.

## `dev storage`

Requires the local flag. Starts SILO, creates the bucket and applies the anonymous read policy. Fails with `STORAGE_UNAVAILABLE` when no binary is found.

## Plan output

All four commands respect `--dry-run`: no database writes, no object-storage writes, no file writes, no processes.
