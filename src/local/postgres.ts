import type { LogLike } from '../shared/index'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../cli/logger'
import { commandOutput, firstExisting, listDir, readLogTail, resolveLogPath } from './util'

export interface PostgresInstall {
  pgCtl: string
  dataDir: string
}

function resolveScoopPrefix(): string | undefined {
  if (process.platform !== 'win32')
    return undefined
  const fromCli = commandOutput('scoop', ['prefix', 'postgresql'])
  if (fromCli && existsSync(fromCli))
    return fromCli
  return undefined
}

/**
 * Locate `pg_ctl` and its data directory.
 *
 * Order: `PG_CTL` → `PATH` → Scoop → standard install directories.
 * `PGDATA` always wins for the data directory.
 */
export function resolvePostgresInstall(): PostgresInstall | undefined {
  if (process.platform === 'win32') {
    const scoopPrefix = resolveScoopPrefix()
    const programDirs = listDir(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL'))
      .sort()
      .reverse()

    const fromWhere = commandOutput('where', ['pg_ctl'])?.split(/\r?\n/)[0]?.trim()
    const pgCtl = firstExisting([
      process.env.PG_CTL,
      fromWhere,
      scoopPrefix && join(scoopPrefix, 'bin', 'pg_ctl.exe'),
      process.env.SCOOP && join(process.env.SCOOP, 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      join(process.env.USERPROFILE ?? '', 'scoop', 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      join('C:\\', 'Scoop', 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      ...programDirs.map(dir => join(dir, 'bin', 'pg_ctl.exe')),
    ])

    if (!pgCtl)
      return undefined

    const dataDir = firstExisting([
      process.env.PGDATA,
      scoopPrefix && join(scoopPrefix, 'data'),
      process.env.SCOOP && join(process.env.SCOOP, 'persist', 'postgresql', 'data'),
      join(process.env.USERPROFILE ?? '', 'scoop', 'persist', 'postgresql', 'data'),
      join('C:\\', 'Scoop', 'persist', 'postgresql', 'data'),
      ...programDirs.map(dir => join(dir, 'data')),
    ])

    return dataDir
      ? { pgCtl, dataDir }
      : undefined
  }

  const pgConfigBindir = commandOutput('pg_config', ['--bindir'])
  const versionedBins = [
    ...listDir('/usr/lib/postgresql').map(dir => join(dir, 'bin')),
    ...listDir('/opt/homebrew/opt').filter(dir => /postgresql/.test(dir)).map(dir => join(dir, 'bin')),
    ...listDir('/usr/local/opt').filter(dir => /postgresql/.test(dir)).map(dir => join(dir, 'bin')),
  ]
  const fromPath = commandOutput('which', ['pg_ctl'])

  const pgCtl = firstExisting([
    process.env.PG_CTL,
    fromPath,
    pgConfigBindir && join(pgConfigBindir, 'pg_ctl'),
    ...versionedBins.map(dir => join(dir, 'pg_ctl')),
  ])
  if (!pgCtl)
    return undefined

  const dataDir = firstExisting([
    process.env.PGDATA,
    ...listDir('/opt/homebrew/var').filter(dir => /postgres/.test(dir)),
    ...listDir('/usr/local/var').filter(dir => /postgres/.test(dir)),
    ...listDir('/var/lib/postgresql').map(dir => join(dir, 'main')),
  ])

  return dataDir
    ? { pgCtl, dataDir }
    : undefined
}

export interface EnsurePostgresOptions {
  databaseUrl: string
  /** Log directory for Postgres output. */
  logsDir: string
  log?: LogLike
  /** Report the plan without starting anything. */
  dryRun?: boolean
}

/**
 * Start Postgres unless it is already running.
 *
 * Already running instances are reused; on failure the log tail is attached
 * so the caller can see the actual cause.
 */
export function ensurePostgresRunning(options: EnsurePostgresOptions): void {
  const log = options.log ?? createLogger({ name: 'dev.db' })
  const install = resolvePostgresInstall()
  if (!install) {
    const parsed = new URL(options.databaseUrl)
    throw new Error(
      `pg_ctl (or its data directory) was not found. Install PostgreSQL and set PGDATA; port ${parsed.port || 5432}.`,
    )
  }

  if (options.dryRun) {
    log.info(`dry-run: would ensure Postgres is running (${install.dataDir})`)
    return
  }

  const status = spawnSync(install.pgCtl, ['status', '-D', install.dataDir], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (status.status === 0) {
    log.info(`Postgres is already running (${install.dataDir})`)
    return
  }
  if (status.status === 4) {
    throw new Error(`Postgres data directory is unavailable: ${install.dataDir} (${status.stderr?.trim() || status.stdout?.trim()})`)
  }

  const logFile = resolveLogPath(options.logsDir, 'postgres.log')
  log.info(`starting Postgres (${install.dataDir}) ...`)
  // stdio must be ignore: postmaster inherits pg_ctl's pipes and Bun's spawnSync waits for EOF.
  const start = spawnSync(
    install.pgCtl,
    [
      'start',
      '-D',
      install.dataDir,
      '-l',
      logFile,
      '-w',
      '-t',
      '60',
    ],
    { stdio: 'ignore', windowsHide: true },
  )
  if (start.status !== 0) {
    const tail = readLogTail(logFile)
    throw new Error(`Postgres failed to start (exit ${start.status ?? 'signal'}, log ${logFile})${tail
      ? `:\n${tail}`
      : ''}`)
  }
}
