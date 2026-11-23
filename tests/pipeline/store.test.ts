import type { PipelineSnapshot } from '../../src/pipeline/types'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PipelineStoreError } from '../../src/pipeline/errors'
import {
  createFilePipelineStore,
  createMemoryPipelineStore,
  validateRunId,
} from '../../src/pipeline/store'

/** `flush` is optional on the interface; the file store always provides it. */
function flushStore(store: { flush?: () => Promise<void> }): Promise<void> {
  return store.flush
    ? store.flush()
    : Promise.resolve()
}

function snapshot(runId: string): PipelineSnapshot {
  return {
    version: 1,
    runId,
    status: 'running',
    startedAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    stages: {},
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devkit-pipeline-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('validateRunId', () => {
  it.each(['ingest-2026-11-23', 'a', 'A.b_c-1'])('accepts %s', (runId) => {
    expect(() => validateRunId(runId)).not.toThrow()
  })

  it.each([
    '',
    '../escape',
    'with space',
    'a/b',
    '.hidden',
    'x'.repeat(129),
  ])('rejects %s', (runId) => {
    expect(() => validateRunId(runId)).toThrow(PipelineStoreError)
  })
})

describe('createFilePipelineStore', () => {
  it('round-trips a snapshot', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    const written = snapshot('run-a')
    await store.save(written)
    await flushStore(store)

    const loaded = await store.load('run-a')
    expect(loaded).toEqual(written)
  })

  it('returns undefined for a missing run', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await expect(store.load('missing')).resolves.toBeUndefined()
  })

  it('writes atomically and leaves no temp files behind', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await store.save(snapshot('run-b'))
    await flushStore(store)

    expect(readdirSync(dir)).toEqual(['run-b.json'])
  })

  it('coalesces saves inside the flush window', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 60 })
    const first = snapshot('run-c')
    const second = snapshot('run-c')
    second.status = 'succeeded'

    await Promise.all([
      store.save(first),
      store.save(second),
    ])
    await flushStore(store)

    await expect(store.load('run-c')).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('serializes on save so a later mutation cannot leak into the written file', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    const changing = snapshot('run-d')
    const pending = store.save(changing)
    changing.status = 'failed'
    await pending
    await flushStore(store)

    await expect(store.load('run-d')).resolves.toMatchObject({ status: 'running' })
  })

  it('surfaces corrupt JSON as a store error', async () => {
    writeFileSync(join(dir, 'run-e.json'), '{ not json')
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await expect(store.load('run-e')).rejects.toMatchObject({ code: 'CORRUPT_SNAPSHOT' })
  })

  it('rejects a snapshot written for another run', async () => {
    writeFileSync(join(dir, 'run-f.json'), JSON.stringify(snapshot('other')))
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await expect(store.load('run-f')).rejects.toMatchObject({ code: 'CORRUPT_SNAPSHOT' })
  })

  it('rejects a snapshot with the wrong version', async () => {
    const older = {
      ...snapshot('run-g'),
      version: 0,
    }
    writeFileSync(join(dir, 'run-g.json'), JSON.stringify(older))
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await expect(store.load('run-g')).rejects.toMatchObject({ code: 'CORRUPT_SNAPSHOT' })
  })

  it('rejects an unsafe run id before touching the filesystem', async () => {
    const store = createFilePipelineStore({ dir, flushIntervalMs: 5 })
    await expect(store.load('../escape')).rejects.toBeInstanceOf(PipelineStoreError)
    await expect(store.save(snapshot('../escape'))).rejects.toBeInstanceOf(PipelineStoreError)
  })
})

describe('createMemoryPipelineStore', () => {
  it('stores copies, not references', async () => {
    const store = createMemoryPipelineStore()
    const value = snapshot('run-h')
    await store.save(value)
    value.status = 'failed'

    await expect(store.load('run-h')).resolves.toMatchObject({ status: 'running' })
    expect(store.peek('run-h')).toMatchObject({ status: 'running' })
  })

  it('returns undefined for a missing run', async () => {
    const store = createMemoryPipelineStore()
    await expect(store.load('nope')).resolves.toBeUndefined()
    expect(store.peek('nope')).toBeUndefined()
  })
})
