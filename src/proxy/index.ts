/**
 * Local development proxy: translate Neon's HTTP `/sql` protocol to a local Postgres.
 *
 * workerd (astro dev / preview) cannot open TCP connections, and
 * `@neondatabase/serverless` only speaks Neon's `/sql` protocol. This module is
 * the minimal bridge. It only accepts local database URLs so a remote database
 * is never exposed on localhost.
 *
 * Batch requests (`{ queries: [...] }`) run on one connection inside a single
 * transaction, matching the driver's `transaction()` contract. PostgreSQL error
 * fields are forwarded so callers can keep branching on SQLSTATE.
 */
import { Pool } from 'pg'
import { isLocalUrl } from '../shared/index'

interface QueryRequest {
  query: string
  params?: unknown[]
}

interface QueryField {
  name: string
  dataTypeID: number
}

export interface ProxyQueryResult {
  command: string | null
  rowCount: number | null
  fields: QueryField[]
  rows: unknown[][]
}

interface QueryConfig {
  text: string
  values: unknown[]
  rowMode: 'array'
}

interface Queryable {
  query: (config: QueryConfig) => Promise<ProxyQueryResult>
}

export interface ProxyConnection extends Queryable {
  release: () => void
}

/** Test seam: the subset of `pg.Pool` the handler needs. */
export interface ProxyPool extends Queryable {
  connect: () => Promise<ProxyConnection>
  end: () => Promise<void>
}

export interface ProxyHandler {
  (request: Request): Promise<Response>
  /** Release the underlying connection pool. */
  close: () => Promise<void>
}

export interface CreateProxyHandlerOptions {
  databaseUrl: string
  /** Test seam; defaults to a `pg.Pool` built from `databaseUrl`. */
  pool?: ProxyPool
}

/** Fields the Neon driver copies from a 400 response onto `NeonDbError`. */
const ERROR_FIELDS = [
  'severity',
  'code',
  'detail',
  'hint',
  'position',
  'internalPosition',
  'internalQuery',
  'where',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'file',
  'line',
  'routine',
] as const

const ISOLATION_LEVELS = new Set([
  'read uncommitted',
  'read committed',
  'repeatable read',
  'serializable',
])

export interface BatchOptions {
  isolationLevel?: string
  readOnly: boolean
  deferrable: boolean
}

/** Parse the batch headers the Neon driver sets for `transaction()`. */
export function parseBatchOptions(headers: Headers): BatchOptions {
  const raw = headers.get('neon-batch-isolation-level')?.trim().toLowerCase()
  if (raw && !ISOLATION_LEVELS.has(raw))
    throw new Error(`Invalid Neon-Batch-Isolation-Level: ${raw}`)

  return {
    ...(raw
      ? { isolationLevel: raw }
      : {}),
    readOnly: headers.get('neon-batch-read-only') === 'true',
    deferrable: headers.get('neon-batch-deferrable') === 'true',
  }
}

/** Build the `BEGIN` statement for the batch headers. */
export function batchBeginStatement(options: BatchOptions): string {
  const parts = ['BEGIN']
  if (options.isolationLevel)
    parts.push(`ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`)
  if (options.readOnly)
    parts.push('READ ONLY')
  if (options.deferrable)
    parts.push('DEFERRABLE')
  return parts.join(' ')
}

function errorBody(error: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    message: error instanceof Error
      ? error.message
      : String(error),
  }
  if (error && typeof error === 'object') {
    const source = error as Record<string, unknown>
    for (const field of ERROR_FIELDS) {
      const value = source[field]
      if (value !== undefined && value !== null)
        body[field] = value
    }
  }
  return body
}

function assertLocalDatabase(databaseUrl: string): void {
  if (!isLocalUrl(databaseUrl))
    throw new Error(`The development proxy only accepts local database URLs, received ${databaseUrl}`)
}

/**
 * Build the request handler. Creation is synchronous; the pool connects lazily,
 * which makes the handler easy to exercise in-process and in tests.
 */
export function createProxyHandler(options: CreateProxyHandlerOptions): ProxyHandler {
  assertLocalDatabase(options.databaseUrl)

  const target = new URL(options.databaseUrl)
  const host = target.host
  const database = target.pathname.slice(1)

  const pool = options.pool ?? (new Pool({
    connectionString: options.databaseUrl,
    // Return raw text so the Neon driver can parse by dataTypeID.
    types: {
      getTypeParser: () => (value: string) => value,
    },
  }) as unknown as ProxyPool)

  let queryCount = 0
  let requestCount = 0

  const runQuery = async (database: Queryable, request: QueryRequest): Promise<ProxyQueryResult> => {
    if (typeof request?.query !== 'string')
      throw new TypeError('Each query must contain a "query" string')

    queryCount += 1
    const result = await database.query({
      text: request.query,
      values: request.params ?? [],
      rowMode: 'array',
    })

    return {
      command: result.command,
      rowCount: result.rowCount,
      fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
      rows: result.rows,
    }
  }

  const runBatch = async (queries: QueryRequest[], batch: BatchOptions): Promise<ProxyQueryResult[]> => {
    const client = await pool.connect()
    try {
      await client.query({
        text: batchBeginStatement(batch),
        values: [],
        rowMode: 'array',
      })
      try {
        const results: ProxyQueryResult[] = []
        for (const query of queries) results.push(await runQuery(client, query))
        await client.query({ text: 'COMMIT', values: [], rowMode: 'array' })
        return results
      }
      catch (error) {
        await client.query({ text: 'ROLLBACK', values: [], rowMode: 'array' }).catch(() => {})
        throw error
      }
    }
    finally {
      client.release()
    }
  }

  const handler = (async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        pid: process.pid,
        host,
        database,
        queries: queryCount,
        requests: requestCount,
      })
    }
    if (request.method !== 'POST' || url.pathname !== '/sql')
      return new Response('not found', { status: 404 })

    requestCount += 1
    try {
      const body = await request.json() as QueryRequest & { queries?: QueryRequest[] }
      if (Array.isArray(body.queries))
        return Response.json({ results: await runBatch(body.queries, parseBatchOptions(request.headers)) })

      return Response.json(await runQuery(pool, body))
    }
    catch (error) {
      return Response.json(errorBody(error), { status: 400 })
    }
  }) as ProxyHandler

  handler.close = async (): Promise<void> => {
    await pool.end()
  }
  return handler
}

export interface StartProxyOptions extends CreateProxyHandlerOptions {
  port?: number
}

export interface RunningProxy {
  url: string
  port: number
  close: () => Promise<void>
}

/** Start the proxy with `Bun.serve` and return its address plus a close handle. */
export function startProxy(options: StartProxyOptions): RunningProxy {
  const handler = createProxyHandler(options)
  const server = Bun.serve({
    port: options.port ?? 4444,
    hostname: '127.0.0.1',
    fetch: handler,
  })
  const port = server.port ?? options.port ?? 4444

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    async close() {
      await server.stop(true)
      await handler.close()
    },
  }
}
