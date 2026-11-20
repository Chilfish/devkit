import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { neon, neonConfig } from '@neondatabase/serverless'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureDatabase, resolveBunBinary, resolveProxyEntry } from '../../src/local/index'

/**
 * Real driver scenario: the official `@neondatabase/serverless` client talks to
 * the background proxy entry, so protocol drift breaks this test instead of a
 * downstream app.
 *
 * Opt in with DEVKIT_PG_SMOKE=1 and a reachable server.
 */
const enabled = process.env.DEVKIT_PG_SMOKE === '1'
const adminUrl = process.env.DEVKIT_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres'
const databaseName = `devkit_neon_${process.pid}_${Date.now().toString(36)}`
const targetUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
})()
const port = 21_000 + Math.floor(Math.random() * 20_000)

async function waitForHealth(url: string, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok)
        return
    }
    catch {
      // Not ready yet.
    }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 100))
  }
  throw new Error(`proxy did not become healthy at ${url}`)
}

describe.skipIf(!enabled)('neon driver against the local proxy', () => {
  let proxy: ChildProcess | undefined
  let sql: ReturnType<typeof neon>

  beforeAll(async () => {
    await ensureDatabase(targetUrl)
    proxy = spawn(resolveBunBinary(), [
      resolveProxyEntry(),
    ], {
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
        DEVKIT_PROXY_PORT: String(port),
      },
      stdio: 'ignore',
      windowsHide: true,
    })

    await waitForHealth(`http://127.0.0.1:${port}/health`)
    neonConfig.fetchEndpoint = () => `http://127.0.0.1:${port}/sql`
    sql = neon(targetUrl)
    await sql`create table neon_items (id serial primary key, name text unique)`
  }, 60_000)

  afterAll(async () => {
    proxy?.kill()
    const admin = new Pool({ connectionString: adminUrl })
    try {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [databaseName])
      await admin.query(`drop database if exists "${databaseName}"`)
    }
    finally {
      await admin.end()
    }
  })

  it('runs a tagged template and returns typed rows', async () => {
    const rows = await sql`select 1::int as n, 'ok'::text as label` as Array<{ n: number, label: string }>
    expect(rows).toEqual([
      { n: 1, label: 'ok' },
    ])
  })

  it('runs a parameterized query', async () => {
    const rows = await sql.query('select $1::int as n', [2]) as Array<{ n: number }>
    expect(rows).toEqual([
      { n: 2 },
    ])
  })

  it('commits a successful transaction on one connection', async () => {
    await sql.transaction([
      sql`insert into neon_items (name) values ('first')`,
      sql`insert into neon_items (name) values ('second')`,
    ])

    const rows = await sql`select count(*)::int as total from neon_items` as Array<{ total: number }>
    expect(rows[0]?.total).toBe(2)
  })

  it('rolls the whole transaction back when one statement fails', async () => {
    await expect(sql.transaction([
      sql`insert into neon_items (name) values ('rolled-back')`,
      sql`insert into neon_items (name) values ('first')`,
    ])).rejects.toMatchObject({ code: '23505' })

    const rows = await sql`select count(*)::int as total from neon_items where name = 'rolled-back'` as Array<{ total: number }>
    expect(rows[0]?.total).toBe(0)
  })

  it('preserves SQLSTATE and constraint details on errors', async () => {
    const error = await sql`insert into neon_items (name) values ('first')`.then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(error).toMatchObject({
      code: '23505',
      constraint: 'neon_items_name_key',
      severity: 'ERROR',
    })
  })
})
