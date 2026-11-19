import type { CommandGroup, CommandSpec } from '../cli'
import type { DevkitConfig } from '../index'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Option } from 'commander'
import { CliError, ConfigError } from '../cli'
import {
  applyMigrations,
  ensureDatabase,
  ensureDevServices,
  ensureEnvFile,
  ensurePostgresRunning,
  resolveBunBinary,
} from '../local'
import { startProxy } from '../proxy'
import { isLocalMode, isLocalUrl } from '../shared/index'
import { ensureSiloRunning } from '../storage'

/** Resolve a command from `node_modules/.bin` first, then fall back to `PATH`. */
export function resolveCommand(command: string): string {
  if (command.includes('/') || command.includes('\\'))
    return command
  const binDir = join(process.cwd(), 'node_modules', '.bin')
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

function runtimeBinary(runtime: 'node' | 'bun'): string {
  return runtime === 'bun'
    ? resolveBunBinary()
    : (process.env.NODE ?? 'node')
}

function devDbSpec(config: DevkitConfig): CommandSpec {
  return {
    id: 'dev.db',
    description: 'initialize the local database: start Postgres, create the database, apply migrations, sync the env file',
    details: 'Does not start the dev server. Global `--dry-run` only reports the steps; nothing is started or written.',
    examples: ['bun run dev db', `bun run dev db --url ${config.database.localUrl}`],
    options: [
      new Option('--url <url>', 'target database URL, defaults to the configured local URL'),
    ],
    async run(ctx) {
      const override = ctx.options.url
      const databaseUrl = typeof override === 'string' && override.length > 0
        ? override
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

function devProxySpec(config: DevkitConfig): CommandSpec {
  return {
    id: 'dev.proxy',
    description: 'run the Neon HTTP-compatible proxy in the foreground and forward /sql to local Postgres',
    details: 'workerd cannot open TCP connections, so astro dev / preview needs this proxy. '
      + 'Only local `DATABASE_URL` values are accepted. The server runs in the foreground; end it with Ctrl-C. '
      + '`dev server` starts the same proxy on demand, so running this separately is optional.',
    examples: ['bun run dev proxy', 'bun run dev proxy --port 4444'],
    options: [
      new Option('--port <n>', 'listen port, defaults to the configured proxy endpoint'),
    ],
    async run(ctx) {
      const databaseUrl = process.env.DATABASE_URL
      if (!databaseUrl) {
        throw new ConfigError('Missing environment variable DATABASE_URL', {
          code: 'MISSING_ENV',
          hint: `Set DATABASE_URL in ${config.env.file}, or run "bun run dev db" first`,
          context: { name: 'DATABASE_URL' },
        })
      }
      if (!isLocalUrl(databaseUrl)) {
        throw new CliError(`The development proxy only accepts local database URLs, received ${databaseUrl}`, {
          code: 'NON_LOCAL_DATABASE',
          hint: `Point DATABASE_URL in ${config.env.file} back at localhost, or run "bun run dev db" first`,
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

function devStorageSpec(config: DevkitConfig): CommandSpec {
  return {
    id: 'dev.storage',
    description: 'start local object storage (SILO) and prepare the bucket without starting the dev server',
    details: 'Requires the local flag (can live in the env file): the endpoint must be local. '
      + '`dev server` takes the same path automatically; use this to verify the endpoint, bucket and anonymous read before uploads.',
    examples: ['bun run dev storage', 'LOCAL=1 bun run dev storage --json'],
    async run(ctx) {
      if (!isLocalMode(process.env, config.env.localFlag)) {
        throw new CliError(`requires ${config.env.localFlag}=1 (can be set in ${config.env.file})`, {
          code: 'NOT_LOCAL_MODE',
          hint: `Set ${config.env.localFlag}=1 in ${config.env.file}`,
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

function devServerSpec(config: DevkitConfig): CommandSpec {
  return {
    id: 'dev.server',
    description: 'start the dev servers: bring up Postgres / database / migrations / proxy first, then run every configured server',
    details: [
      'Postgres and the proxy are independent background processes: they survive the dev server, and repeated runs reuse them.',
      '',
      'Arguments after `--` are forwarded to the first configured server:',
      '  bun run dev server -- --port 4322',
      '',
      'Global `--dry-run` only checks the plan and starts nothing.',
    ].join('\n'),
    examples: ['bun run dev', 'bun run dev server', 'bun run dev server -- --port 4322'],
    arguments: [
      { name: 'args...', description: 'arguments after `--`, forwarded to the first server', required: false },
    ],
    async run(ctx) {
      const servers = config.dev.servers
      const forwarded = ctx.args.slice()

      if (ctx.dryRun) {
        for (const server of servers) {
          ctx.log.info(`dry-run: would run ${server.runtime} ${resolveCommand(server.command)} ${[
            ...server.args,
            ...(servers[0] === server
              ? forwarded
              : []),
          ].join(' ')}`.trimEnd())
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
        const args = [
          ...server.args,
          ...(servers[0] === server
            ? forwarded
            : []),
        ]
        const executable = runtimeBinary(server.runtime)
        const command = resolveCommand(server.command)
        ctx.log.child(server.name).info(`starting ${server.runtime} ${command} ${args.join(' ')}`.trimEnd())
        const child = spawn(executable, [command, ...args], {
          stdio: 'inherit',
          env: process.env,
          shell: process.platform === 'win32' && /\.cmd$/i.test(command),
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

/** Build the built-in `dev` command group for a project. */
export function createDevCommands(config: DevkitConfig): CommandGroup {
  return {
    name: 'dev',
    description: 'local development: dev servers, Postgres, Neon HTTP proxy and SILO object storage',
    commands: [
      devServerSpec(config),
      devDbSpec(config),
      devProxySpec(config),
      devStorageSpec(config),
    ],
  }
}

export { ensureDevServices } from '../local'
