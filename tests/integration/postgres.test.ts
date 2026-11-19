import type { ProxyHandler } from '../../src/proxy/index'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, ensureDatabase } from '../../src/local/index'
import { createProxyHandler } from '../../src/proxy/index'

/**
 * Real database scenario: create a database, apply drizzle migrations, then
 * query it through the Neon `/sql` handler.
 *
 * Opt in with DEVKIT_PG_SMOKE=1 and a reachable server.
 */
const enabled = process.env.DEVKIT_PG_SMOKE === '1'
const adminUrl = process.env.DEVKIT_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres'
const databaseName = `devkit_smoke_${process.pid}_${Date.now().toString(36)}`
const migrationsFolder = fileURLToPath(new URL('../fixtures/migrations', import.meta.url))

const targetUrl = (() => {
  const url = new URL(adminUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
})()

describe.skipIf(!enabled)('postgres integration', () => {
  let handler: ProxyHandler

  beforeAll(async () => {
    await ensureDatabase(targetUrl)
    await applyMigrations(targetUrl, migrationsFolder)
    handler = createProxyHandler({ databaseUrl: targetUrl })
  }, 60_000)

  afterAll(async () => {
    await handler?.close()
    const admin = new Pool({ connectionString: adminUrl })
    try {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [databaseName])
      await admin.query(`drop database if exists "${databaseName}"`)
    }
    finally {
      await admin.end()
    }
  })

  it('reports the migrated database on /health', async () => {
    const response = await handler(new Request('http://127.0.0.1/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, database: databaseName })
  })

  it('executes a parameterized query against the migrated schema', async () => {
    const inserted = await handler(new Request('http://127.0.0.1/sql', {
      method: 'POST',
      body: JSON.stringify({
        query: 'insert into smoke_items (name) values ($1) returning id, name',
        params: ['first'],
      }),
    }))
    expect(inserted.status).toBe(200)
    const insertResult = await inserted.json() as { command: string, rows: unknown[][] }
    expect(insertResult.command).toBe('INSERT')
    expect(insertResult.rows[0]?.[1]).toBe('first')

    const selected = await handler(new Request('http://127.0.0.1/sql', {
      method: 'POST',
      body: JSON.stringify({ query: 'select count(*)::int as total from smoke_items' }),
    }))
    const selectResult = await selected.json() as { rows: unknown[][] }
    expect(selectResult.rows[0]?.[0]).toBe('1')
  })

  it('executes batch queries in order', async () => {
    const response = await handler(new Request('http://127.0.0.1/sql', {
      method: 'POST',
      body: JSON.stringify({
        queries: [
          { query: 'select 1 as n' },
          {
            query: 'select $1::int as m',
            params: [2],
          },
        ],
      }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as { results: { rows: unknown[][] }[] }
    expect(body.results).toHaveLength(2)
    expect(body.results[0]?.rows[0]?.[0]).toBe('1')
    expect(body.results[1]?.rows[0]?.[0]).toBe('2')
  })

  it('returns a 400 with the database message for invalid SQL', async () => {
    const response = await handler(new Request('http://127.0.0.1/sql', {
      method: 'POST',
      body: JSON.stringify({ query: 'select * from missing_table' }),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('missing_table'),
    })
  })
})
