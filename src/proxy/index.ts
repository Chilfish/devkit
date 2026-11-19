/**
 * Local development proxy: translate Neon's HTTP `/sql` protocol to a local Postgres.
 *
 * workerd (astro dev / preview) cannot open TCP connections, and
 * `@neondatabase/serverless` only speaks Neon's `/sql` protocol. This module is
 * the minimal bridge. It only accepts local database URLs so a remote database
 * is never exposed on localhost.
 */
import { Pool } from 'pg'
import { isLocalUrl } from '../shared/index'

interface QueryRequest {
  query: string
  params?: unknown[]
}

interface QueryResult {
  command: string | null
  rowCount: number | null
  fields: { name: string, dataTypeID: number }[]
  rows: unknown[][]
}

export interface ProxyHandler {
  (request: Request): Promise<Response>
  /** Release the underlying connection pool. */
  close: () => Promise<void>
}

export interface CreateProxyHandlerOptions {
  databaseUrl: string
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

  const pool = new Pool({
    connectionString: options.databaseUrl,
    // Return raw text so the Neon driver can parse by dataTypeID.
    types: {
      getTypeParser: () => (value: string) => value,
    },
  })

  let queryCount = 0
  let requestCount = 0

  const runQuery = async (request: QueryRequest): Promise<QueryResult> => {
    queryCount += 1
    const result = await pool.query({
      text: request.query,
      values: request.params ?? [],
      rowMode: 'array',
    })

    return {
      command: result.command,
      rowCount: result.rowCount,
      fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
      rows: result.rows as unknown[][],
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
      if (Array.isArray(body.queries)) {
        const results: QueryResult[] = []
        for (const query of body.queries) results.push(await runQuery(query))
        return Response.json({ results })
      }
      return Response.json(await runQuery(body))
    }
    catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error)
      return Response.json({ message }, { status: 400 })
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
