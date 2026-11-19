import type { ProxyHandler, RunningProxy } from '../../src/proxy/index'
import { afterEach, describe, expect, it } from 'vitest'
import { createProxyHandler, startProxy } from '../../src/proxy/index'

let handler: ProxyHandler | undefined
let proxy: RunningProxy | undefined

afterEach(async () => {
  await handler?.close()
  await proxy?.close()
  handler = undefined
  proxy = undefined
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
