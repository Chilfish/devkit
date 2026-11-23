import type { DevkitConfig } from '../index'
import type { LogLike } from '../shared/index'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createLogger } from '../cli/logger'
import {
  isLocalMode,
  localBucket,
  localEndpoint,
  localPublicBase,
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
 * Write the local service addresses into the local mode file.
 *
 * The target is `<file>.dev` when it exists, otherwise the base `<file>`; the
 * declared keys are overwritten while comments and other lines are preserved.
 * Remote mode writes nothing: `<file>.prod` holds the deployment's own values
 * and must not receive localhost addresses.
 */
export function ensureEnvFile(options: EnsureEnvFileOptions): void {
  const { config } = options
  const log = options.log ?? createLogger({ name: 'dev.db' })
  const cwd = options.cwd ?? process.cwd()

  if (!isLocalMode(process.env, config.env.localFlag)) {
    log.info(`remote mode: ${resolve(cwd, `${config.env.file}.prod`)} left untouched; it keeps the deployment values`)
    return
  }

  const flag = config.env.localFlag
  const modeFile = resolve(cwd, `${config.env.file}.dev`)
  const path = existsSync(modeFile)
    ? modeFile
    : resolve(cwd, config.env.file)

  const values: Record<string, string> = {
    DATABASE_URL: options.databaseUrl,
    NEON_HTTP_ENDPOINT: options.endpoint,
    [flag]: '1',
  }
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
    log.info(`wrote ${path}`)
    return
  }

  const content = readFileSync(path, 'utf8')
  const next = upsertEnvValues(content, values)
  if (next !== content) {
    writeFileSync(path, next)
    log.info(`${path} switched to local: ${Object.keys(values).join(' / ')}`)
  }
}
