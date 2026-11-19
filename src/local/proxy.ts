import type { DevkitConfig } from '../index'
import type { LogLike } from '../shared/index'
import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '../cli/logger'
import { isLocalUrl } from '../shared/index'
import { readLogTail, resolveLogPath, sleep } from './util'

export interface ProxyHealth {
  ok: boolean
  pid?: number
  host?: string
  database?: string
}

/**
 * Absolute path of the background proxy entry.
 *
 * Resolved from this module, never from `cwd` or the host project's script
 * layout — that is exactly how the old `scripts/dev-db-proxy.ts` reference broke.
 */
export function resolveProxyEntry(): string {
  const candidates = [
    new URL('../bin/proxy.js', import.meta.url),
    new URL('../bin/proxy.ts', import.meta.url),
  ]
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate)
    if (existsSync(path))
      return path
  }
  throw new Error('Background proxy entry not found. Build the package or run from source with Bun.')
}

/** Resolve the Bun executable used to run the proxy entry. */
export function resolveBunBinary(): string {
  if (process.versions.bun)
    return process.execPath
  return process.env.BUN_BIN ?? 'bun'
}

async function getProxyHealth(endpoint: string): Promise<ProxyHealth | undefined> {
  try {
    const response = await fetch(new URL('/health', endpoint), {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok)
      return undefined
    return await response.json() as ProxyHealth
  }
  catch {
    return undefined
  }
}

export interface EnsureDevProxyOptions {
  config: DevkitConfig
  databaseUrl: string
  log?: LogLike
  dryRun?: boolean
  /** Polling interval in milliseconds; tests override it. */
  pollIntervalMs?: number
  /** Maximum polling attempts before giving up. */
  attempts?: number
}

/**
 * Ensure the background `/sql` proxy is running and points at `databaseUrl`.
 *
 * A healthy proxy for the same database is reused. A proxy bound to the port but
 * connected to another database is an error: silently reusing it would serve
 * queries from the wrong database.
 */
export async function ensureDevProxy(options: EnsureDevProxyOptions): Promise<void> {
  const log = options.log ?? createLogger({ name: 'dev.proxy' })
  const endpoint = options.config.database.proxyEndpoint

  if (!isLocalUrl(endpoint)) {
    log.info(`proxy endpoint is not local, skipping the development proxy: ${endpoint}`)
    return
  }

  const target = new URL(options.databaseUrl)
  const database = target.pathname.slice(1)
  const host = target.host

  if (options.dryRun) {
    log.info(`dry-run: would ensure the proxy at ${endpoint} targets ${host}/${database}`)
    return
  }

  const health = await getProxyHealth(endpoint)
  if (health?.ok) {
    if (health.database === database && health.host === host) {
      log.info(`reusing running proxy (pid ${health.pid ?? '?'}, ${health.database})`)
      return
    }
    throw new Error(
      `Port is used by another development proxy: pid ${health.pid ?? '?'} targets `
      + `${health.host ?? '?'}/${health.database ?? '?'}, expected ${host}/${database}. `
      + `Stop that process or change the proxy port and endpoint.`,
    )
  }

  const logFile = resolveLogPath(options.config.paths.logs, 'dev-proxy.log')
  const fd = openSync(logFile, 'a')
  const port = new URL(endpoint).port || '4444'
  const entry = resolveProxyEntry()
  const bun = resolveBunBinary()
  const env = {
    ...process.env,
    DATABASE_URL: options.databaseUrl,
    DEVKIT_PROXY_PORT: port,
  }

  if (process.platform === 'win32') {
    // `start` detaches the proxy from the parent process tree; taskkill /T and closing the terminal leave it running.
    const child = spawn('cmd.exe', ['/c', 'start', '', '/b', bun, entry], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env,
    })
    child.unref()
  }
  else {
    const child = spawn(bun, [entry], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', fd, fd],
      env,
    })
    child.unref()
  }
  log.info(`starting development proxy (log ${join(options.config.paths.logs, 'dev-proxy.log')})`)

  const attempts = options.attempts ?? 50
  const interval = options.pollIntervalMs ?? 200
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(interval)
    const started = await getProxyHealth(endpoint)
    if (started?.ok) {
      log.info(`proxy ready (pid ${started.pid ?? '?'}): ${endpoint} -> ${started.host ?? host}/${started.database ?? database}`)
      return
    }
  }

  const tail = readLogTail(logFile)
  throw new Error(`Development proxy failed to start (${endpoint})${tail
    ? `:\n${tail}`
    : `, see ${logFile}`}`)
}
