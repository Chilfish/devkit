# Built-in commands

`createDevCommands(config)` returns a `dev` group with five commands. Every command accepts the global options listed in [cli](../guide/cli.md).

## Options

```ts
createDevCommands(config, {
  serverLocalFlag: true,
  strings: {
    groupDescription: 'local environment',
    commands: {
      server: { description: 'start dev servers', examples: ['bun run ymmt dev server'] },
      db: { optionDescriptions: { url: 'target database URL' } },
    },
  },
})
```

- `serverLocalFlag`: adds `--local` to `dev server` and sets `<localFlag>=1` for that run, re-loading the env file so local defaults apply.
- `strings`: overrides group/command descriptions, details, examples and option descriptions while keeping command ids and options intact.

## `dev server`

Brings up the local stack, then starts every configured server.

- Postgres, the proxy and SILO survive the dev server and are reused on the next run.
- `--` arguments are forwarded to the first configured server.
- Signals are forwarded to all servers; the first non-zero exit code becomes the command exit code.
- `--local` (when `serverLocalFlag` is enabled) sets `<localFlag>=1` and reloads the env file.
- A bare `command` is resolved through `node_modules/<command>/package.json` → `bin` and run with the configured runtime. If no manifest entry exists, a Windows `.cmd` / `.bat` / `.exe` shim is executed directly instead of being passed to `node`.
- `command` equal to the runtime itself (`runtime: 'bun', command: 'bun'`) runs the runtime with the given arguments, without duplicating it.
- `--dry-run` reports the planned processes without starting anything.
- Without `dev.servers`, the command fails with `NO_DEV_SERVERS` (exit 3).
- In `--json` mode child stdout is routed to stderr so stdout keeps one envelope line.

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

Requires the local flag. Starts SILO, creates the bucket and applies the anonymous read policy. Fails with `NOT_LOCAL_MODE` (exit 3) without the flag, and `STORAGE_UNAVAILABLE` (exit 1) when no binary is found.

## `dev status`

Read-only diagnosis of the local stack: Postgres reachability, proxy `/health` (pid, host, database), SILO health and the configured endpoints. A down service is reported as `running: false` instead of failing the command.

There is no `dev stop`. devkit starts the system Postgres but does not own it, so stopping it would affect unrelated projects; SILO exposes no pid. Stop services with `pg_ctl` / `taskkill` as described in [local development](../guide/local-dev.md#stop-and-reset).

## Plan output

All four commands respect `--dry-run`: no database writes, no object-storage writes, no file writes, no processes.
