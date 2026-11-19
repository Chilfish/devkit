import type { DevkitConfig } from '../index'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError } from '../cli/exit'
import { isLocalUrl } from '../shared/index'
import { readEnvFile } from './load'

export interface OnlineTarget {
  /** Raw values from the environment file. */
  remote: Record<string, string>
  /** Remote database URL read from `DATABASE_URL<suffix>`. */
  databaseUrl: string
  /** Remote bucket, from `R2_BUCKET<suffix>` or `R2_BUCKET`. */
  bucket: string
}

export interface ReadOnlineTargetOptions {
  config: DevkitConfig
  /** Repository root. Defaults to the current working directory. */
  cwd?: string
}

function remoteKey(config: DevkitConfig, key: string): string {
  return `${key}${config.env.onlineSuffix}`
}

/**
 * Read and validate the remote target from the environment file.
 *
 * Only the file is trusted here; a remote switch must not silently pick up
 * local process variables. Missing file, missing target key and a local target
 * all fail with exit code 1, matching the behavior downstream projects had.
 */
export function readOnlineTarget(options: ReadOnlineTargetOptions): OnlineTarget {
  const { config } = options
  const path = resolve(options.cwd ?? process.cwd(), config.env.file)

  if (!existsSync(path)) {
    throw new CliError(`Environment file not found: ${path}`, {
      code: 'MISSING_ENV',
      hint: `Create ${config.env.file} and set ${remoteKey(config, 'DATABASE_URL')}`,
      exitCode: 1,
    })
  }

  const remote = readEnvFile(path)
  const databaseKey = remoteKey(config, 'DATABASE_URL')
  const databaseUrl = remote[databaseKey]
  if (!databaseUrl) {
    throw new CliError(`${config.env.file} is missing ${databaseKey}`, {
      code: 'MISSING_ENV',
      hint: `Set ${databaseKey} to the remote database URL`,
      context: { key: databaseKey },
      exitCode: 1,
    })
  }
  if (isLocalUrl(databaseUrl)) {
    throw new CliError(`${databaseKey} points at localhost (${databaseUrl}), refusing to switch`, {
      code: 'NON_LOCAL_DATABASE',
      hint: `Use the remote database URL for ${databaseKey}, and the local flag for local work`,
      context: { databaseUrl },
      exitCode: 1,
    })
  }

  const bucket = remote[remoteKey(config, 'R2_BUCKET')] ?? remote.R2_BUCKET ?? ''
  return { remote, databaseUrl, bucket }
}

export interface ApplyOnlineEnvOptions {
  config: DevkitConfig
  remote: Record<string, string>
}

/**
 * Switch the current process to the remote target and return a restore function.
 *
 * `*<suffix>` values are expanded into their base keys, the local flag is set
 * to `0`, and local-only endpoints are cleared so no module falls back to a
 * local service. The returned function restores the previous process state.
 */
export function applyOnlineEnv(options: ApplyOnlineEnvOptions): () => void {
  const { config, remote } = options
  const suffix = config.env.onlineSuffix
  const saved = new Map<string, string | undefined>()

  const set = (key: string, value: string | undefined): void => {
    if (!saved.has(key))
      saved.set(key, process.env[key])
    if (value === undefined)
      delete process.env[key]
    else process.env[key] = value
  }

  for (const [key, value] of Object.entries(remote)) {
    if (key === config.env.localFlag)
      continue
    if (suffix && key.endsWith(suffix)) {
      set(key.slice(0, -suffix.length), value)
    }
    else if (key !== 'DATABASE_URL') {
      set(key, value)
    }
  }

  set(config.env.localFlag, '0')
  for (const key of [
    suffix
      ? remoteKey(config, 'DATABASE_URL')
      : '',
    'NEON_HTTP_ENDPOINT',
    'S3_ENDPOINT',
    'MINIO_ENDPOINT',
    'SILO_BIN',
    'SILO_DATA',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
  ]) {
    if (key)
      set(key, undefined)
  }

  return () => {
    for (const [key, value] of saved) {
      if (value === undefined)
        delete process.env[key]
      else process.env[key] = value
    }
  }
}
