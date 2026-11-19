import type { DevkitConfig } from '../index'
import type { LogLike } from '../shared/index'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createLogger } from '../cli/logger'
import {
  isLocalMode,
  isLocalUrl,
  localBucket,
  localEndpoint,
  localPublicBase,
  parseEnvContent,
  upsertEnvValues,
} from '../shared/index'

export interface EnsureEnvFileOptions {
  config: DevkitConfig
  databaseUrl: string
  endpoint: string
  /** Repository root. Defaults to the current working directory. */
  cwd?: string
  log?: LogLike
  dryRun?: boolean
}

/**
 * Point the environment file at local services.
 *
 * In local mode declared keys are overwritten while comments, blank lines and
 * `*_ONLINE` targets are preserved. In remote mode only missing keys are added,
 * so existing values are never clobbered.
 */
export function ensureEnvFile(options: EnsureEnvFileOptions): void {
  const { config } = options
  const log = options.log ?? createLogger({ name: 'dev.db' })
  const path = resolve(options.cwd ?? process.cwd(), config.env.file)
  const flag = config.env.localFlag
  const local = isLocalMode(process.env, flag)

  const values: Record<string, string> = {
    DATABASE_URL: options.databaseUrl,
    NEON_HTTP_ENDPOINT: options.endpoint,
  }
  if (local)
    values[flag] = '1'
  if (config.storage.publicBaseEnv) {
    values[config.storage.publicBaseEnv] = localPublicBase(
      localEndpoint(process.env),
      localBucket(process.env, config.storage.bucket),
    )
  }

  if (options.dryRun) {
    log.info(`dry-run: would update ${path} (${Object.keys(values).join(' / ')})`)
    return
  }

  if (!existsSync(path)) {
    writeFileSync(
      path,
      `# Local development variables; do not commit\n${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    )
    log.info(`wrote ${config.env.file}`)
    return
  }

  const content = readFileSync(path, 'utf8')
  if (local) {
    const next = upsertEnvValues(content, values)
    if (next !== content) {
      writeFileSync(path, next)
      log.info(`${config.env.file} switched to local: ${Object.keys(values).join(' / ')}`)
    }
    return
  }

  const parsed = parseEnvContent(content)
  const missing = Object.entries(values).filter(([key]) => parsed[key] === undefined)
  if (missing.length > 0) {
    const prefix = content.endsWith('\n')
      ? content
      : `${content}\n`
    writeFileSync(path, `${prefix}${missing.map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
    log.info(`${config.env.file} appended: ${missing.map(([key]) => key).join(' / ')}`)
  }

  const configured = parsed.DATABASE_URL
  if (configured && !isLocalUrl(configured)) {
    log.warn(`${config.env.file} DATABASE_URL is not local (${new URL(configured).host}); dev server will use the remote database`)
  }
}
