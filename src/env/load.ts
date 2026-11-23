import type { DevkitConfig } from '../index'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isLocalMode,
  isLocalUrl,
  localBucket,
  localEndpoint,
  localPublicBase,
  parseDatabaseInfo,
  parseEnvContent,
} from '../shared/index'

/** Read an environment file without writing to `process.env`. */
export function readEnvFile(path: string): Record<string, string> {
  return parseEnvContent(readFileSync(path, 'utf8'))
}

/** Mode file suffix: the local flag selects `.dev`, everything else `.prod`. */
function modeSuffix(local: boolean): 'dev' | 'prod' {
  return local
    ? 'dev'
    : 'prod'
}

function readIfExists(path: string): Record<string, string> {
  return existsSync(path)
    ? readEnvFile(path)
    : {}
}

/**
 * One-line description of where this run reads and writes: mode, database host
 * and name, storage address. Only addressing information, never credentials.
 */
export function describeEnvironment(env: Record<string, string | undefined>, config: DevkitConfig): string {
  const flag = config.env.localFlag
  const local = isLocalMode(env, flag)
  const databaseUrl = local && !isLocalUrl(env.DATABASE_URL)
    ? config.database.localUrl
    : env.DATABASE_URL
  const database = parseDatabaseInfo(databaseUrl)

  const storage = local
    ? `local storage ${localPublicBase(localEndpoint(env), localBucket(env, config.storage.bucket))}`
    : env.R2_BUCKET
      ? `R2 storage ${env.R2_BUCKET}`
      : null

  return [
    local
      ? `local mode (${flag}=1)`
      : 'remote mode',
    database
      ? `database ${database.host}${database.database
        ? `/${database.database}`
        : ''}`
      : null,
    storage,
  ].filter(Boolean).join(' · ')
}

export interface LoadEnvOptions {
  config: DevkitConfig
  /** Repository root. Defaults to the current working directory. */
  cwd?: string
  /** Print the environment banner to stderr. The CLI sets false and logs it itself. */
  log?: boolean
}

/**
 * Read the environment files and fill `process.env`.
 *
 * Files are stacked, like `.env` loaders: `env.file` (default `.env`) first,
 * then `<file>.dev` when the local flag is on or `<file>.prod` when it is off.
 * A missing mode file is skipped, so a project can keep everything in the base
 * file. Later files override earlier ones and process variables always win.
 *
 * The local flag itself resolves as process environment > base file.
 */
export function loadEnvFile(options: LoadEnvOptions): void {
  const { config } = options
  const flag = config.env.localFlag
  const cwd = options.cwd ?? process.cwd()
  const base = readIfExists(resolve(cwd, config.env.file))

  const local = process.env[flag] !== undefined
    ? isLocalMode(process.env, flag)
    : isLocalMode(base, flag)
  const modeFile = readIfExists(resolve(cwd, `${config.env.file}.${modeSuffix(local)}`))

  const merged: Record<string, string> = {}
  Object.assign(merged, base, modeFile)
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined)
      process.env[key] = value
  }

  if (local) {
    process.env[flag] = '1'
    applyLocalDefaults(config)
  }
  else {
    process.env[flag] = '0'
    if (isLocalUrl(process.env.DATABASE_URL)) {
      delete process.env.DATABASE_URL
      warn(`remote mode but DATABASE_URL points at localhost: set the remote database in ${config.env.file}.prod, or ${flag}=1 for local development`)
    }
  }

  if (options.log !== false)
    warn(describeEnvironment(process.env, config))
}

/** With the local flag on, force database, proxy and media URLs back to this machine. */
function applyLocalDefaults(config: DevkitConfig): void {
  if (!isLocalUrl(process.env.DATABASE_URL))
    process.env.DATABASE_URL = config.database.localUrl
  if (!isLocalUrl(process.env.NEON_HTTP_ENDPOINT))
    process.env.NEON_HTTP_ENDPOINT = config.database.proxyEndpoint
  if (config.storage.publicBaseEnv) {
    process.env[config.storage.publicBaseEnv] = localPublicBase(
      localEndpoint(process.env),
      localBucket(process.env, config.storage.bucket),
    )
  }
}

function warn(message: string): void {
  process.stderr.write(`[env] ${message}\n`)
}
