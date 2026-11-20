import type { ProxyHandler, ProxyPool, ProxyQueryResult, RunningProxy } from '../../src/proxy/index'
import { afterEach, describe, expect, it } from 'vitest'
import { batchBeginStatement, createProxyHandler, parseBatchOptions, startProxy } from '../../src/proxy/index'

let handler: ProxyHandler | undefined
let proxy: RunningProxy | undefined

afterEach(async () => {
  await handler?.close()
  await proxy?.close()
  handler = undefined
  proxy = undefined
})

const emptyResult: ProxyQueryResult = {
  command: null,
  rowCount: null,
  fields: [],
  rows: [],
}

function result(rows: unknown[][] = []): ProxyQueryResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    fields: [
      { name: 'n', dataTypeID: 23 },
    ],
    rows,
  }
}

function fakePool(options: {
  single?: (text: string) => ProxyQueryResult
  batch?: (text: string) => ProxyQueryResult
} = {}): {
  pool: ProxyPool
  calls: string[]
  releases: number
  connected: number
} {
  const calls: string[] = []
  let releases = 0
  let connected = 0

  const run = (text: string, kind: 'single' | 'batch'): ProxyQueryResult => {
    calls.push(text)
    if (text === 'BEGIN' || text.startsWith('BEGIN ') || text === 'COMMIT' || text === 'ROLLBACK')
      return emptyResult
    if (kind === 'single')
      return options.single?.(text) ?? result()
    return options.batch?.(text) ?? result()
  }

  return {
    calls,
    get releases() {
      return releases
    },
    get connected() {
      return connected
    },
    pool: {
      query: async ({ text }) => run(text, 'single'),
      connect: async () => {
        connected += 1
        return {
          query: async ({ text }) => run(text, 'batch'),
          release: () => {
            releases += 1
          },
        }
      },
      end: async () => {},
    },
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:4444/sql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('parseBatchOptions', () => {
  it('defaults to a plain transaction', () => {
    expect(parseBatchOptions(new Headers())).toEqual({ readOnly: false, deferrable: false })
  })

  it('reads isolation, read-only and deferrable headers', () => {
    const headers = new Headers({
      'neon-batch-isolation-level': 'Serializable',
      'neon-batch-read-only': 'true',
      'neon-batch-deferrable': 'true',
    })
    expect(parseBatchOptions(headers)).toEqual({
      isolationLevel: 'serializable',
      readOnly: true,
      deferrable: true,
    })
  })

  it('rejects an unknown isolation level', () => {
    expect(() => parseBatchOptions(new Headers({ 'neon-batch-isolation-level': 'chaos' })))
      .toThrow(/Invalid Neon-Batch-Isolation-Level/)
  })
})

describe('batchBeginStatement', () => {
  it('keeps a plain transaction plain', () => {
    expect(batchBeginStatement({ readOnly: false, deferrable: false })).toBe('BEGIN')
  })

  it('builds the full transaction mode', () => {
    expect(batchBeginStatement({
      isolationLevel: 'repeatable read',
      readOnly: true,
      deferrable: true,
    })).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY DEFERRABLE')
  })
})

describe('createProxyHandler', () => {
  it('rejects non-local databases', () => {
    expect(() => createProxyHandler({ databaseUrl: 'postgres://user@db.example.com/app' })).toThrow(/local database/)
  })

  it('returns not found for unknown routes', async () => {
    handler = createProxyHandler({ databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev' })
    const response = await handler(new Request('http://127.0.0.1:4444/other'))
    expect(response.status).toBe(404)
  })

  it('reports target database and counters on /health', async () => {
    handler = createProxyHandler({ databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev' })
    const response = await handler(new Request('http://127.0.0.1:4444/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      host: 'localhost:5432',
      database: 'devkit_dev',
      queries: 0,
      requests: 0,
    })
  })

  it('runs a single query through the pool', async () => {
    const fake = fakePool({
      single: () => result([
        [1],
      ]),
    })
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post({ query: 'select 1 as n' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      command: 'SELECT',
      rowCount: 1,
      fields: [
        { name: 'n', dataTypeID: 23 },
      ],
      rows: [
        [1],
      ],
    })
    expect(fake.calls).toEqual(['select 1 as n'])
    expect(fake.connected).toBe(0)
  })

  it('runs a batch on one client inside a transaction with the driver headers', async () => {
    const fake = fakePool({
      batch: text => result(text === 'select $1'
        ? [
            [2],
          ]
        : [
            [1],
          ]),
    })
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post(
      {
        queries: [
          { query: 'select 1 as n' },
          {
            query: 'select $1',
            params: [2],
          },
        ],
      },
      {
        'neon-batch-isolation-level': 'serializable',
        'neon-batch-read-only': 'true',
      },
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      results: [
        {
          rows: [
            [1],
          ],
        },
        {
          rows: [
            [2],
          ],
        },
      ],
    })
    expect(fake.calls).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY',
      'select 1 as n',
      'select $1',
      'COMMIT',
    ])
    expect(fake.connected).toBe(1)
    expect(fake.releases).toBe(1)
  })

  it('rolls the batch back and forwards PostgreSQL error fields', async () => {
    const fake = fakePool({
      batch: (text) => {
        if (text === 'boom') {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            severity: 'ERROR',
            detail: 'Key (name)=(first) already exists.',
            constraint: 'items_name_key',
          })
        }
        return result()
      },
    })
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post({
      queries: [
        { query: 'insert 1' },
        { query: 'boom' },
      ],
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      severity: 'ERROR',
      detail: 'Key (name)=(first) already exists.',
      constraint: 'items_name_key',
    })
    expect(fake.calls).toEqual([
      'BEGIN',
      'insert 1',
      'boom',
      'ROLLBACK',
    ])
    expect(fake.releases).toBe(1)
  })

  it('forwards PostgreSQL error fields for a single query', async () => {
    const fake = fakePool({
      single: () => {
        throw Object.assign(new Error('relation "missing" does not exist'), {
          code: '42P01',
          hint: 'check the schema',
        })
      },
    })
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post({ query: 'select * from missing' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: 'relation "missing" does not exist',
      code: '42P01',
      hint: 'check the schema',
    })
  })

  it('rejects an invalid isolation header before touching the database', async () => {
    const fake = fakePool()
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post(
      {
        queries: [
          { query: 'select 1' },
        ],
      },
      { 'neon-batch-isolation-level': 'chaos' },
    ))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('chaos'),
    })
    expect(fake.calls).toEqual([])
    expect(fake.connected).toBe(0)
  })

  it('rejects a body without a query', async () => {
    const fake = fakePool()
    handler = createProxyHandler({
      databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      pool: fake.pool,
    })

    const response = await handler(post({ params: [] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('query'),
    })
  })
})

describe.skipIf(typeof Bun === 'undefined')('startProxy', () => {
  it('serves /health and exposes the bound port', async () => {
    proxy = startProxy({ databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev', port: 0 })
    const response = await fetch(`${proxy.url}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, database: 'devkit_dev' })
    expect(proxy.url).toBe(`http://127.0.0.1:${proxy.port}`)
  })
})
