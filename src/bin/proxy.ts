#!/usr/bin/env bun
/**
 * Background proxy entry, spawned by the local orchestrator by absolute path.
 *
 * Reads `DATABASE_URL` and the port, then serves `/sql` and `/health`.
 * Exit codes: 3 missing configuration, 1 runtime failure.
 */
import process from 'node:process'
import { startProxy } from '../proxy/index'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  process.stderr.write('[dev.proxy] DATABASE_URL is required\n')
  process.exit(3)
}

const port = Number(process.env.DEVKIT_PROXY_PORT ?? process.env.DEV_DB_PROXY_PORT ?? 4444)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  process.stderr.write(`[dev.proxy] invalid proxy port: ${process.env.DEVKIT_PROXY_PORT ?? process.env.DEV_DB_PROXY_PORT}\n`)
  process.exit(3)
}

try {
  const target = new URL(databaseUrl)
  const proxy = startProxy({ databaseUrl, port })
  process.stdout.write(`[dev.proxy] ${proxy.url}/sql -> ${target.host}${target.pathname}\n`)

  const stop = async (): Promise<void> => {
    await proxy.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
catch (error) {
  process.stderr.write(`[dev.proxy] ${error instanceof Error
    ? error.message
    : String(error)}\n`)
  process.exit(1)
}
