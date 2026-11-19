import type { EnvelopeMeta } from '../../src/cli/envelope'
import { describe, expect, it } from 'vitest'
import { buildEnvelope, serializeEnvelope } from '../../src/cli/envelope'

const meta: EnvelopeMeta = {
  mode: 'local',
  durationMs: 3,
  dryRun: false,
  version: '0.1.0',
}

describe('buildEnvelope', () => {
  it('fills a successful envelope', () => {
    const envelope = buildEnvelope({
      command: 'dev.db',
      ok: true,
      data: { url: 'x' },
      meta,
    })
    expect(envelope).toEqual({
      ok: true,
      command: 'dev.db',
      data: { url: 'x' },
      error: null,
      meta,
    })
  })

  it('nulls data on failure and fills a default error', () => {
    const envelope = buildEnvelope({
      command: 'dev.db',
      ok: false,
      data: { ignored: true },
      meta,
    })
    expect(envelope.data).toBeNull()
    expect(envelope.error).toEqual({ code: 'FAILED', message: 'Unknown error' })
  })

  it('keeps the provided error', () => {
    const envelope = buildEnvelope({
      command: 'dev.db',
      ok: false,
      error: { code: 'MISSING_ENV', message: 'missing', hint: 'set it' },
      meta,
    })
    expect(envelope.error).toEqual({ code: 'MISSING_ENV', message: 'missing', hint: 'set it' })
  })
})

describe('serializeEnvelope', () => {
  it('produces exactly one line', () => {
    const text = serializeEnvelope(buildEnvelope({
      command: 'dev.db',
      ok: true,
      data: { a: 1 },
      meta,
    }))
    expect(text.split('\n')).toHaveLength(1)
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      command: 'dev.db',
      data: { a: 1 },
    })
  })
})
