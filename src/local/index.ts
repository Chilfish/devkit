import type { DevkitConfig } from '../index'
import type { LogLike } from '../shared/index'
import { createLogger } from '../cli/logger'
import { isLocalUrl } from '../shared/index'
import { ensureSiloRunning } from '../storage/index'
import { applyMigrations, ensureDatabase } from './database'
import { ensureEnvFile } from './env-file'
import { ensurePostgresRunning } from './postgres'
import { ensureDevProxy } from './proxy'
import { isPortOpen } from './util'

export interface EnsureDevServicesOptions {
  config: DevkitConfig
  /** Repository root. Defaults to the current working directory. */
  cwd?: string
  log?: LogLike
  /** Report the plan only: no processes, no writes. */
  dryRun?: boolean
  /** Start the local object store as part of the stack. Defaults to true. */
  storage?: boolean
  /** Override the database URL, e.g. for benchmarks and ad-hoc scripts. */
  databaseUrl?: string
  /** Override the proxy endpoint. */
  endpoint?: string
}

export interface DevServicesResult {
  local: boolean
  databaseUrl: string
  endpoint: string
}

/**
 * Bring up the local stack: Postgres, database, migrations, environment file,
 * `/sql` proxy and (optionally) SILO.
 *
 * Background services survive the foreground command; repeated runs health-check
 * and reuse them. Remote databases are left untouched.
 */
export async function ensureDevServices(options: EnsureDevServicesOptions): Promise<DevServicesResult> {
  const { config } = options
  const log = options.log ?? createLogger({ name: 'dev' })
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL || config.database.localUrl
  const endpoint = options.endpoint || process.env.NEON_HTTP_ENDPOINT || config.database.proxyEndpoint

  if (!isLocalUrl(databaseUrl)) {
    log.warn(
      `DATABASE_URL is not local (${new URL(databaseUrl).host}); skipping local Postgres. `
      + `Point DATABASE_URL back at localhost or set ${config.env.localFlag}=1.`,
    )
    return { local: false, databaseUrl, endpoint }
  }

  if (options.dryRun) {
    const steps = [
      'ensurePostgresRunning',
      'ensureDatabase',
      'applyMigrations',
      'ensureEnvFile',
      'ensureDevProxy',
    ]
    if (options.storage !== false)
      steps.push('ensureSiloRunning')
    log.info(`dry-run: would initialize ${databaseUrl} (${steps.join(' -> ')}), no services started and no files written`)
    return { local: true, databaseUrl, endpoint }
  }

  ensurePostgresRunning({ databaseUrl, logsDir: config.paths.logs, log })
  await ensureDatabase(databaseUrl, { log })
  await applyMigrations(databaseUrl, config.database.migrations, { log })
  ensureEnvFile({
    config,
    databaseUrl,
    endpoint,
    cwd: options.cwd,
    log,
  })

  const parsed = new URL(databaseUrl)
  const port = Number(parsed.port || 5432)
  if (!(await isPortOpen(parsed.hostname, port))) {
    throw new Error(`Postgres is running but ${parsed.hostname}:${port} is unreachable; check pg_hba.conf and listen_addresses`)
  }

  await ensureDevProxy({ config, databaseUrl, log })

  if (options.storage !== false) {
    try {
      const silo = await ensureSiloRunning({ config, log })
      if (!silo.started) {
        log.warn(`local object storage is not running: ${silo.reason}`)
        log.warn('Database-backed pages are unaffected; uploads will fail until SILO is available.')
      }
    }
    catch (error) {
      log.warn(`local object storage failed to start: ${error instanceof Error
        ? error.message
        : String(error)}`)
    }
  }

  return { local: true, databaseUrl, endpoint }
}

export { applyMigrations, ensureDatabase } from './database'
export { ensureEnvFile } from './env-file'
export type { EnsureEnvFileOptions } from './env-file'
export { ensurePostgresRunning, resolvePostgresInstall } from './postgres'
export type { EnsurePostgresOptions, PostgresInstall } from './postgres'
export { ensureDevProxy, resolveBunBinary, resolveProxyEntry } from './proxy'
export type { EnsureDevProxyOptions, ProxyHealth } from './proxy'
