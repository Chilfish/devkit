import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/cli/index'
import { ensureDatabase, ensureDevProxy } from '../../src/local/index'
import { createConfig } from '../testkit/config'

/**
 * Real background-proxy scenario: start from "no proxy running", verify the
 * spawned process, then verify a second call reuses it.
 *
 * Opt in with DEVKIT_PG_SMOKE=1.
 */
const enabled = process.env.DEVKIT_PG_SMOKE === '1'
const adminUrl = process.env.DEVKIT_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres'
const databaseName = `devkit_proxy_${process.pid}_${Date.now().toString(36)}`
const targetUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
})()

const silentLog = createLogger({
  name: 'test',
  write: () => {},
})

describe.skipIf(!enabled)('ensureDevProxy integration', () => {
  let pid: number | undefined
  const port = 20_000 + Math.floor(Math.random() * 20_000)

  beforeAll(async () => {
    await ensureDatabase(targetUrl)
  }, 60_000)

  afterAll(async () => {
    if (pid) {
      try {
        process.kill(pid)
      }
      catch {
        // Already gone; nothing to clean up.
      }
    }
    const admin = new Pool({ connectionString: adminUrl })
    try {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [databaseName])
      await admin.query(`drop database if exists "${databaseName}"`)
    }
    finally {
      await admin.end()
    }
  })

  it('starts the proxy, reports its target, and reuses it on the next call', async () => {
    const endpoint = `http://127.0.0.1:${port}/sql`
    const config = createConfig({
      env: { file: '.dev.vars' },
      database: {
        localUrl: targetUrl,
        proxyEndpoint: endpoint,
        migrations: 'drizzle',
      },
    })

    await ensureDevProxy({
      config,
      databaseUrl: targetUrl,
      log: silentLog,
      attempts: 60,
      pollIntervalMs: 100,
    })

    const health = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json()) as {
      ok: boolean
      pid: number
      database: string
    }
    pid = health.pid
    expect(health.ok).toBe(true)
    expect(health.database).toBe(databaseName)

    // A second call must health-check and reuse instead of spawning another process.
    await ensureDevProxy({
      config,
      databaseUrl: targetUrl,
      log: silentLog,
      attempts: 1,
      pollIntervalMs: 100,
    })
    const reused = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json()) as { pid: number }
    expect(reused.pid).toBe(health.pid)
  }, 60_000)

  it('refuses to reuse a proxy that points at another database', async () => {
    const config = createConfig({
      database: {
        localUrl: 'postgres://postgres@localhost:5432/other_db',
        proxyEndpoint: `http://127.0.0.1:${port}/sql`,
        migrations: 'drizzle',
      },
    })

    await expect(ensureDevProxy({
      config,
      databaseUrl: 'postgres://postgres@localhost:5432/other_db',
      log: silentLog,
      attempts: 1,
      pollIntervalMs: 100,
    })).rejects.toThrow(/another development proxy/)
  })
})
