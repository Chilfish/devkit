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
 * Read the environment file and choose values according to the local flag.
 *
 * - Plain keys in the file are the local developer's values;
 * - remote targets live in `<KEY>_ONLINE`: expanded when the local flag is off,
 *   ignored when it is on;
 * - the file only fills keys absent from the process environment, so explicit
 *   variables always win;
 * - the local flag itself resolves as process environment > file.
 */
export function loadEnvFile(options: LoadEnvOptions): void {
  const { config } = options
  const suffix = config.env.onlineSuffix
  const flag = config.env.localFlag
  const path = resolve(options.cwd ?? process.cwd(), config.env.file)
  const values = existsSync(path)
    ? readEnvFile(path)
    : {}
  const ambient = new Set(Object.keys(process.env))
  const local = process.env[flag] !== undefined
    ? isLocalMode(process.env, flag)
    : isLocalMode(values, flag)

  for (const [key, value] of Object.entries(values)) {
    if (suffix && key.endsWith(suffix))
      continue
    if (ambient.has(key))
      continue
    process.env[key] = value
  }

  if (local) {
    process.env[flag] = '1'
    applyLocalDefaults(config)
  }
  else {
    process.env[flag] = '0'
    expandOnlineValues(values, suffix, ambient)
    if (isLocalUrl(process.env.DATABASE_URL)) {
      delete process.env.DATABASE_URL
      warn(`remote mode but DATABASE_URL points at localhost: set DATABASE_URL${suffix} for the remote database, or ${flag}=1 for local development`)
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

/** Expand `<KEY><suffix>` into `<KEY>`; explicitly set process variables still win. */
function expandOnlineValues(
  values: Record<string, string>,
  suffix: string,
  ambient: Set<string>,
): void {
  if (!suffix)
    return
  for (const [key, value] of Object.entries(values)) {
    if (!key.endsWith(suffix) || value === '')
      continue
    const base = key.slice(0, -suffix.length)
    if (!base || ambient.has(base))
      continue
    process.env[base] = value
  }
}

function warn(message: string): void {
  process.stderr.write(`[env] ${message}\n`)
}
