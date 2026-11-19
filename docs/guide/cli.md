# CLI contract

## Command specs

```ts
import { Option } from 'commander'
import type { CommandGroup, CommandSpec } from '@chilfish/devkit/cli'

const spec: CommandSpec = {
  id: 'data.refresh',
  description: 'refresh the dataset',
  details: 'Longer text shown in --help.',
  examples: ['bun run ymmt data refresh --full'],
  options: [new Option('--full', 'ignore the cache')],
  arguments: [{ name: 'dataset', description: 'dataset id' }],
  async run(ctx) {
    const dataset = ctx.args[0]
    return { data: { dataset }, summary: 'done' }
  },
}
```

`CommandContext` provides:

| Member | Purpose |
|---|---|
| `options` | Parsed command options (globals removed) |
| `args` | Positional arguments |
| `log` | Logger prefixed with the command id; all human output goes to stderr |
| `dryRun` / `json` | Global flags |
| `requireString` / `integer` / `flag` | Typed option access with validation |
| `toArgv` | Rebuild CLI arguments, e.g. while migrating old `main(argv)` bodies |

## Global options

`--json`, `--quiet`, `--dry-run`, `--log-level <level>`, `--log-file <path>`, `-h, --help`, `-V, --version`.

`identity.jsonEnvVar` adds an implicit JSON switch (for example `YMMT_JSON=1`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success / already converged |
| 1 | Runtime failure, including partial batch failure |
| 2 | Usage error: unknown flag, missing required value, invalid value |
| 3 | Missing configuration: env var, credentials or config file |

Throw `UsageError` / `ConfigError` / `CliError` and the runtime maps them to the right code. Commands never call `process.exit` directly.

## JSON envelope

Every `--json` run writes exactly one line to stdout:

```json
{"ok":true,"command":"dev.db","data":{},"error":null,"meta":{"mode":"local","durationMs":12,"dryRun":false,"version":"0.1.0"}}
```

- `error` is `{ code, message, hint?, context? }`.
- `meta.mode` is `local` or `remote`.
- While a command runs in JSON mode, `console.log` is redirected to stderr so `| jq` always parses.

## Logs

- stdout: command data and the JSON envelope only.
- stderr: banners, progress, warnings, errors and help text.
- `--log-file` appends NDJSON lines with time, level, name and message.
- `--log-level debug` adds stack traces.

## describe

```bash
bun run ymmt describe
```

Prints the configured name, version, exit codes, global options and the full command tree as JSON.

## Error shape

Errors carry a stable `code`, a `message`, an optional copy-pasteable `hint` and machine-readable `context`. The environment banner is printed before the command runs, so failures already show the target database and storage.
