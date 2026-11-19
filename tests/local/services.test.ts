import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/cli/index'
import { ensureDevProxy, ensureDevServices } from '../../src/local/index'
import { createConfig } from '../testkit/config'

const config = createConfig()
const log = createLogger({
  name: 'test',
  write: () => {},
})

describe('ensureDevServices overrides', () => {
  it('uses an explicit database URL and endpoint in dry-run mode', async () => {
    const result = await ensureDevServices({
      config,
      log,
      dryRun: true,
      databaseUrl: 'postgres://postgres@127.0.0.1:5433/override_db',
      endpoint: 'http://127.0.0.1:4455/sql',
    })

    expect(result).toEqual({
      local: true,
      databaseUrl: 'postgres://postgres@127.0.0.1:5433/override_db',
      endpoint: 'http://127.0.0.1:4455/sql',
    })
  })

  it('skips local services for a non-local override', async () => {
    const result = await ensureDevServices({
      config,
      log,
      dryRun: true,
      databaseUrl: 'postgres://user@db.example.com:5432/app',
    })

    expect(result.local).toBe(false)
    expect(result.databaseUrl).toBe('postgres://user@db.example.com:5432/app')
  })
})

describe('ensureDevProxy endpoint override', () => {
  it('uses the override in the dry-run plan', async () => {
    const messages: string[] = []
    const capture = createLogger({
      name: 'test',
      write: (_stream, line) => messages.push(line),
    })

    await ensureDevProxy({
      config,
      databaseUrl: 'postgres://postgres@localhost:5432/postgres',
      endpoint: 'http://127.0.0.1:4599/sql',
      dryRun: true,
      log: capture,
    })

    expect(messages.join('\n')).toContain('http://127.0.0.1:4599/sql')
  })
})
