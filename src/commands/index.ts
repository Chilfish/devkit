import type { StdioOptions } from 'node:child_process'
import type { CommandGroup, CommandSpec } from '../cli'
import type { DevkitConfig } from '../index'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Option } from 'commander'
import { CliError, ConfigError } from '../cli'
import { loadEnvFile } from '../env/index'
import {
  applyMigrations,
  ensureDatabase,
  ensureDevServices,
  ensureEnvFile,
  ensurePostgresRunning,
  resolveBunBinary,
} from '../local'
import { buildWindowsCommandLine, isPortOpen } from '../local/util'
import { isLocalMode, isLocalUrl, localEndpoint, parseDatabaseInfo } from '../shared/index'
import { ensureSiloRunning } from '../storage'

/**
 * Nearest package that owns `node_modules`; falls back to the nearest
 * `package.json`, then to the starting directory.
 *
 * The walk stops at the user's home directory, so a stray `~/package.json`
 * or `~/node_modules` can never capture resolution for a project below it.
 */
export function findProjectRoot(start: string = process.cwd()): string {
  const origin = resolve(start)
  const home = resolve(homedir())
  let dir = origin
  let packageRoot: string | undefined

  for (;;) {
    if (dir !== home || dir === origin) {
      if (existsSync(join(dir, 'package.json'))) {
        if (existsSync(join(dir, 'node_modules')))
          return dir
        packageRoot ??= dir
      }
    }
    const parent = dirname(dir)
    if (parent === dir || dir === home)
      break
    dir = parent
  }

  return packageRoot ?? origin
}

/** Resolve a command from `node_modules/.bin` first, then fall back to `PATH`. */
export function resolveCommand(command: string, cwd = process.cwd()): string {
  if (command.includes('/') || command.includes('\\'))
    return command
  const binDir = join(cwd, 'node_modules', '.bin')
  const candidates = process.platform === 'win32'
    ? [
        join(binDir, `${command}.cmd`),
        join(binDir, `${command}.exe`),
        join(binDir, command),
      ]
    : [
        join(binDir, command),
      ]
  return candidates.find(candidate => existsSync(candidate)) ?? command
}

/**
 * Resolve a package's real entry from its manifest.
 *
 * On Windows `node_modules/.bin` contains native shims (`.exe` / `.cmd`), which
 * cannot be passed to `node` as a script. The manifest `bin` target can.
 */
export function resolvePackageBin(command: string, cwd = process.cwd()): string | undefined {
  if (command.includes('/') || command.includes('\\'))
    return undefined
  const packageDir = join(cwd, 'node_modules', command)
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest))
    return undefined

  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }
    const bin = typeof pkg.bin === 'string'
      ? pkg.bin
      : (pkg.bin?.[command] ?? (pkg.bin
          ? Object.values(pkg.bin)[0]
          : undefined))
    if (!bin)
      return undefined
    const entry = join(packageDir, bin)
    return existsSync(entry)
      ? entry
      : undefined
  }
  catch {
    return undefined
  }
}

export interface ServerSpawn {
  executable: string
  args: string[]
  shell: boolean
}

/**
 * Decide how to start a configured dev server.
 *
 * Order: real package entry with the configured runtime, then a usable shim
 * (`.cmd` / `.exe` run directly), then the resolved path with the runtime.
 */
export function resolveServerSpawn(
  server: { runtime: 'node' | 'bun', command: string, args?: readonly string[] },
  extraArgs: string[] = [],
  cwd = findProjectRoot(),
): ServerSpawn {
  const args = [
    ...(server.args ?? []),
    ...extraArgs,
  ]
  const runtime = runtimeBinary(server.runtime)

  // `{ runtime: 'bun', command: 'bun' }` means "run bun with these arguments",
  // not "run bun bun ...".
  const runtimeName = basename(runtime).replace(/\.exe$/i, '').toLowerCase()
  if (server.command.toLowerCase() === runtimeName)
    return { executable: runtime, args, shell: false }

  if (server.command.includes('/') || server.command.includes('\\')) {
    return {
      executable: runtime,
      args: [server.command, ...args],
      shell: false,
    }
  }

  const entry = resolvePackageBin(server.command, cwd)
  if (entry) {
    return {
      executable: runtime,
      args: [entry, ...args],
      shell: false,
    }
  }

  const resolved = resolveCommand(server.command, cwd)
  if (/\.(?:cmd|bat)$/i.test(resolved)) {
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        buildWindowsCommandLine(resolved, args),
      ],
      shell: false,
    }
  }
  if (/\.exe$/i.test(resolved))
    return { executable: resolved, args, shell: false }
  return {
    executable: runtime,
    args: [resolved, ...args],
    shell: false,
  }
}

function runtimeBinary(runtime: 'node' | 'bun'): string {
  return runtime === 'bun'
    ? resolveBunBinary()
    : (process.env.NODE ?? 'node')
}

export type DevCommandKey = 'server' | 'db' | 'proxy' | 'storage' | 'status'

/** Optional text overrides so hosts can keep an existing describe/help contract. */
export interface DevCommandStringOverride {
  description?: string
  details?: string
  examples?: string[]
  /** Keyed by long option name without `--`, e.g. `url`, `port`, `local`. */
  optionDescriptions?: Record<string, string>
}

export interface DevCommandStrings {
  groupDescription?: string
  commands?: Partial<Record<DevCommandKey, DevCommandStringOverride>>
}

export interface DevCommandsOptions {
  strings?: DevCommandStrings
  /** Add `--local` to `dev server` and map it to `<localFlag>=1` for this run. */
  serverLocalFlag?: boolean
}

function optionDescription(
  override: DevCommandStringOverride | undefined,
  key: string,
  fallback: string,
): string {
  return override?.optionDescriptions?.[key] ?? fallback
}

function applyStrings<T>(spec: CommandSpec<T>, override?: DevCommandStringOverride): CommandSpec<T> {
  if (!override)
    return spec
  return {
    ...spec,
    description: override.description ?? spec.description,
    ...(override.details !== undefined || spec.details !== undefined
      ? { details: override.details ?? spec.details }
      : {}),
    ...(override.examples !== undefined || spec.examples !== undefined
      ? { examples: override.examples ?? spec.examples }
      : {}),
  }
}

function devDbSpec(config: DevkitConfig, override?: DevCommandStringOverride): CommandSpec {
  const hint = config.identity.helpHint
  return {
    id: 'dev.db',
    description: 'initialize the local database: start Postgres, create the database, apply migrations, sync the env file',
    details: 'Does not start the dev server. Global `--dry-run` only reports the steps; nothing is started or written.',
    examples: [`${hint} dev db`, `${hint} dev db --url ${config.database.localUrl}`],
    options: [
      new Option('--url <url>', optionDescription(override, 'url', 'target database URL, defaults to the configured local URL')),
    ],
    async run(ctx) {
      const urlOption = ctx.options.url
      const databaseUrl = typeof urlOption === 'string' && urlOption.length > 0
        ? urlOption
        : config.database.localUrl
      const endpoint = process.env.NEON_HTTP_ENDPOINT || config.database.proxyEndpoint
      const steps = [
        'ensurePostgresRunning',
        'ensureDatabase',
        'applyMigrations',
        'ensureEnvFile',
      ]

      if (ctx.dryRun) {
        ctx.log.info(`dry-run: would initialize ${databaseUrl} (${steps.join(' -> ')}), no services started and no files written`)
        return {
          data: { url: databaseUrl, applied: false, steps },
        }
      }

      ensurePostgresRunning({ databaseUrl, logsDir: config.paths.logs, log: ctx.log })
      await ensureDatabase(databaseUrl, { log: ctx.log })
      await applyMigrations(databaseUrl, config.database.migrations, { log: ctx.log })
      ensureEnvFile({
        config,
        databaseUrl,
        endpoint,
        log: ctx.log,
      })
      ctx.log.info('database and migrations are ready')
      return {
        data: { url: databaseUrl, applied: true, steps },
      }
    },
  }
}

function devProxySpec(config: DevkitConfig, override?: DevCommandStringOverride): CommandSpec {
  const hint = config.identity.helpHint
  return {
    id: 'dev.proxy',
    description: 'run the Neon HTTP-compatible proxy in the foreground and forward /sql to local Postgres',
    details: 'workerd cannot open TCP connections, so astro dev / preview needs this proxy. '
      + 'Only local `DATABASE_URL` values are accepted. The server runs in the foreground; end it with Ctrl-C. '
      + '`dev server` starts the same proxy on demand, so running this separately is optional.',
    examples: [`${hint} dev proxy`, `${hint} dev proxy --port 4444`],
    options: [
      new Option('--port <n>', optionDescription(override, 'port', 'listen port, defaults to the configured proxy endpoint')),
    ],
    async run(ctx) {
      const databaseUrl = process.env.DATABASE_URL
      if (!databaseUrl) {
        throw new ConfigError('Missing environment variable DATABASE_URL', {
          code: 'MISSING_ENV',
          hint: `Set DATABASE_URL in ${config.env.file}, or run "${hint} dev db" first`,
          context: { name: 'DATABASE_URL' },
        })
      }
      if (!isLocalUrl(databaseUrl)) {
        throw new CliError(`The development proxy only accepts local database URLs, received ${databaseUrl}`, {
          code: 'NON_LOCAL_DATABASE',
          hint: `Point DATABASE_URL in ${config.env.file} back at localhost, or run "${hint} dev db" first`,
          context: { databaseUrl },
        })
      }

      const endpointPort = Number(new URL(config.database.proxyEndpoint).port || 4444)
      const port = ctx.options.port === undefined
        ? endpointPort
        : ctx.integer('port', endpointPort, 1)
      const target = new URL(databaseUrl)

      if (ctx.dryRun) {
        ctx.log.info(`dry-run: would forward http://127.0.0.1:${port}/sql to ${target.host}/${target.pathname.slice(1)}`)
        return {
          data: { port, databaseUrl, listening: false },
        }
      }

      // Imported lazily: the proxy entry requires `pg`, which is an optional peer.
      // Loading it eagerly would break `dev --help` for projects without `pg`.
      const { startProxy } = await import('../proxy')
      const proxy = startProxy({ databaseUrl, port })
      ctx.log.info(`${proxy.url}/sql -> ${target.host}${target.pathname}`)

      await new Promise<void>((resolveClose) => {
        const stop = async (): Promise<void> => {
          await proxy.close()
          resolveClose()
        }
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
      })

      return {
        data: { port: proxy.port, databaseUrl, listening: true },
      }
    },
  }
}

function devStatusSpec(config: DevkitConfig): CommandSpec {
  const hint = config.identity.helpHint
  const flag = config.env.localFlag
  return {
    id: 'dev.status',
    description: 'report the local stack state without starting or stopping anything',
    details: 'Read-only: checks Postgres reachability, the `/sql` proxy health and SILO health. '
      + 'Reports `running: false` instead of failing when a service is down. '
      + 'devkit does not own the system Postgres instance, so there is no `dev stop`; '
      + `stop services with pg_ctl or taskkill (see docs/guide/local-dev.md).`,
    examples: [`${hint} dev status`, `${hint} dev status --json`],
    async run(_ctx) {
      const databaseUrl = process.env.DATABASE_URL || config.database.localUrl
      const endpoint = process.env.NEON_HTTP_ENDPOINT || config.database.proxyEndpoint
      const storageEndpoint = localEndpoint(process.env)

      const local = isLocalMode(process.env, flag)
      const [databaseUp, proxy, storageUp] = local
        ? await Promise.all([
            isPortOpen(new URL(databaseUrl).hostname, Number(new URL(databaseUrl).port || 5432)),
            readProxyHealth(endpoint),
            readStorageHealth(storageEndpoint),
          ])
        : [false, undefined, false]

      const data = {
        mode: local
          ? 'local'
          : 'remote',
        database: {
          url: databaseUrl,
          running: databaseUp,
        },
        proxy: {
          endpoint,
          running: proxy !== undefined,
          ...(proxy ?? {}),
        },
        storage: {
          endpoint: storageEndpoint,
          running: storageUp,
        },
      }

      const summary = [
        `mode ${data.mode}`,
        `database ${databaseUp
          ? 'running'
          : 'down'} (${parseDatabaseInfo(databaseUrl)?.host ?? databaseUrl})`,
        `proxy ${proxy
          ? `running (pid ${proxy.pid ?? '?'})`
          : 'down'} (${endpoint})`,
        `storage ${storageUp
          ? 'running'
          : 'down'} (${storageEndpoint})`,
      ].join(' · ')

      return { data, summary }
    },
  }
}

async function readProxyHealth(endpoint: string): Promise<{ pid?: number, host?: string, database?: string } | undefined> {
  try {
    const response = await fetch(new URL('/health', endpoint), {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok)
      return undefined
    const body = await response.json() as { ok?: boolean, pid?: number, host?: string, database?: string }
    return body.ok
      ? body
      : undefined
  }
  catch {
    return undefined
  }
}

async function readStorageHealth(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  }
  catch {
    return false
  }
}

function devStorageSpec(config: DevkitConfig): CommandSpec {
  const hint = config.identity.helpHint
  const flag = config.env.localFlag
  return {
    id: 'dev.storage',
    description: 'start local object storage (SILO) and prepare the bucket without starting the dev server',
    details: `Requires ${flag}=1 (can live in the env file): the endpoint must be local. `
      + '`dev server` takes the same path automatically; use this to verify the endpoint, bucket and anonymous read before uploads.',
    examples: [`${hint} dev storage`, `${flag}=1 ${hint} dev storage --json`],
    async run(ctx) {
      if (!isLocalMode(process.env, flag)) {
        throw new ConfigError(`requires ${flag}=1 (can be set in ${config.env.file})`, {
          code: 'NOT_LOCAL_MODE',
          hint: `Set ${flag}=1 in ${config.env.file}`,
        })
      }

      const result = await ensureSiloRunning({ config, log: ctx.log, dryRun: ctx.dryRun })
      if (ctx.dryRun) {
        return {
          data: { local: true, endpoint: result.endpoint, started: false },
        }
      }

      if (!result.started) {
        throw new CliError(result.reason ?? 'local object storage is not ready', {
          code: 'STORAGE_UNAVAILABLE',
          hint: 'Install SILO and add it to PATH (or set SILO_BIN), then rerun',
        })
      }

      return {
        data: { local: true, endpoint: result.endpoint, started: true },
      }
    },
  }
}

function devServerSpec(
  config: DevkitConfig,
  options: DevCommandsOptions,
  override?: DevCommandStringOverride,
): CommandSpec {
  const hint = config.identity.helpHint
  const flag = config.env.localFlag
  const localFlag = options.serverLocalFlag === true
  const optionList = [
    ...(localFlag
      ? [
          new Option('--local', optionDescription(override, 'local', `set ${flag}=1 for this run`)),
        ]
      : []),
  ]

  const details = [
    'Postgres and the proxy are independent background processes: they survive the dev server, and repeated runs reuse them.',
    '',
    'Arguments after `--` are forwarded to the first configured server:',
    `  ${hint} dev server -- --port 4322`,
    '',
    localFlag
      ? `\`--local\` sets ${flag}=1: database, object storage and media URLs switch to this machine.`
      : '',
    'Global `--dry-run` only checks the plan and starts nothing.',
  ].filter(line => line !== '').join('\n')

  const examples = [
    'bun run dev',
    `${hint} dev server`,
    ...(localFlag
      ? [`${hint} dev server --local`]
      : []),
    `${hint} dev server -- --port 4322`,
  ]

  return {
    id: 'dev.server',
    description: 'start the dev servers: bring up Postgres / database / migrations / proxy first, then run every configured server',
    details,
    examples,
    options: optionList,
    arguments: [
      { name: 'args...', description: 'arguments after `--`, forwarded to the first server', required: false },
    ],
    async run(ctx) {
      const servers = config.dev.servers
      if (servers.length === 0) {
        throw new ConfigError('No dev servers are configured', {
          code: 'NO_DEV_SERVERS',
          hint: 'Add dev.servers to defineDevkit(), or use dev db / dev proxy / dev storage directly',
        })
      }
      const forwarded = ctx.args.slice()

      if (ctx.flag('local')) {
        process.env[flag] = '1'
        loadEnvFile({ config, log: false })
      }

      if (ctx.dryRun) {
        for (const server of servers) {
          const plan = resolveServerSpawn(server, servers[0] === server
            ? forwarded
            : [])
          ctx.log.info(`dry-run: would run ${plan.executable} ${plan.args.join(' ')}`.trimEnd())
        }
        return {
          data: {
            servers: servers.map(server => server.name),
            spawned: false,
          },
        }
      }

      await ensureDevServices({
        config,
        log: ctx.log.child('services'),
      })

      const children = servers.map((server) => {
        const plan = resolveServerSpawn(server, servers[0] === server
          ? forwarded
          : [])
        ctx.log.child(server.name).info(`starting ${plan.executable} ${plan.args.join(' ')}`.trimEnd())
        // In JSON mode stdout belongs to the envelope; child stdout goes to stderr.
        const stdio: StdioOptions = ctx.json
          ? ['inherit', 2, 2]
          : 'inherit'
        const child = spawn(plan.executable, plan.args, {
          stdio,
          env: process.env,
          shell: plan.shell,
        })
        child.on('error', (error) => {
          ctx.log.child(server.name).error(`failed to start: ${error.message}`)
        })
        return child
      })

      const forward = (signal: NodeJS.Signals): void => {
        for (const child of children) {
          if (!child.killed)
            child.kill(signal)
        }
      }
      process.on('SIGINT', forward)
      process.on('SIGTERM', forward)

      const codes = await Promise.all(children.map(child => new Promise<number | null>((resolveExit) => {
        child.on('exit', code => resolveExit(code))
      })))

      process.off('SIGINT', forward)
      process.off('SIGTERM', forward)

      const failed = codes.find(code => code !== null && code !== 0)
      return {
        exitCode: failed ?? 0,
        data: {
          servers: servers.map(server => server.name),
          spawned: true,
          exitCodes: codes,
        },
      }
    },
  }
}

/**
 * Build the built-in `dev` command group for a project.
 *
 * `options.strings` lets a host preserve its existing help/describe text, and
 * `options.serverLocalFlag` adds the downstream `--local` switch.
 */
export function createDevCommands(config: DevkitConfig, options: DevCommandsOptions = {}): CommandGroup {
  const strings = options.strings
  return {
    name: 'dev',
    description: strings?.groupDescription ?? 'local development: dev servers, Postgres, Neon HTTP proxy and SILO object storage',
    commands: [
      applyStrings(devServerSpec(config, options, strings?.commands?.server), strings?.commands?.server),
      applyStrings(devDbSpec(config, strings?.commands?.db), strings?.commands?.db),
      applyStrings(devProxySpec(config, strings?.commands?.proxy), strings?.commands?.proxy),
      applyStrings(devStorageSpec(config), strings?.commands?.storage),
      applyStrings(devStatusSpec(config), strings?.commands?.status),
    ],
  }
}

export { ensureDevServices } from '../local'
