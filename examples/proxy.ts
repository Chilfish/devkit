/**
 * Foreground proxy example. Needs a reachable local Postgres:
 *
 *   LOCAL=1 DATABASE_URL=postgres://postgres@localhost:5432/postgres bun examples/proxy.ts
 *
 * Then:
 *   curl http://127.0.0.1:4444/health
 *   curl -X POST http://127.0.0.1:4444/sql -H 'content-type: application/json' -d '{"query":"select 1"}'
 */
import { startProxy } from '../src/proxy/index'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required, e.g. postgres://postgres@localhost:5432/postgres')
  process.exit(3)
}

const proxy = startProxy({
  databaseUrl,
  port: Number(process.env.DEVKIT_PROXY_PORT ?? 4444),
})
console.log(`${proxy.url}/sql`)
process.on('SIGINT', () => proxy.close())
