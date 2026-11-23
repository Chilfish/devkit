import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PipelineConfigError, PipelineWorkerError } from '../../src/pipeline/errors'
import { runPipeline } from '../../src/pipeline/runner'
import { createMemoryPipelineStore } from '../../src/pipeline/store'
import { resolveWorkerEntry, WorkerPool } from '../../src/pipeline/worker-pool'

const handler = fileURLToPath(new URL('./fixtures/worker-handler.ts', import.meta.url))

describe('resolveWorkerEntry', () => {
  it('finds the worker entry next to the module', () => {
    expect(resolveWorkerEntry()).toMatch(/worker-entry\.(?:js|ts)$/)
  })
})

describe('workerPool', () => {
  it('runs a task on a worker thread', async () => {
    const pool = new WorkerPool({ size: 1, entry: handler, exportName: 'square' })
    try {
      await expect(pool.execute(7, ctx(), 5_000)).resolves.toBe(49)
    }
    finally {
      await pool.close()
    }
  })

  it('spreads work over several threads', async () => {
    const pool = new WorkerPool({ size: 3, entry: handler, exportName: 'thread' })
    try {
      const results = await Promise.all([
        pool.execute({ id: 1, delayMs: 50 }, ctx(), 5_000),
        pool.execute({ id: 2, delayMs: 50 }, ctx(), 5_000),
        pool.execute({ id: 3, delayMs: 50 }, ctx(), 5_000),
      ])
      const threads = new Set(results.map(result => (result as { threadId: number }).threadId))
      expect(threads.size).toBe(3)
    }
    finally {
      await pool.close()
    }
  })

  it('propagates handler errors with the worker code', async () => {
    const pool = new WorkerPool({ size: 1, entry: handler, exportName: 'fail' })
    try {
      await expect(pool.execute('x', ctx(), 5_000)).rejects.toBeInstanceOf(PipelineWorkerError)
    }
    finally {
      await pool.close()
    }
  })

  it('rejects when the export is not a function', async () => {
    const pool = new WorkerPool({ size: 1, entry: handler, exportName: 'notAFunction' })
    try {
      await expect(pool.execute('x', ctx(), 5_000)).rejects.toThrow(/is not a function/)
    }
    finally {
      await pool.close()
    }
  })

  it('rejects when the handler module cannot be loaded', async () => {
    const pool = new WorkerPool({ size: 1, entry: `${handler}.missing.ts`, exportName: 'run' })
    try {
      await expect(pool.execute(1, ctx(), 5_000)).rejects.toBeInstanceOf(PipelineWorkerError)
    }
    finally {
      await pool.close()
    }
  })

  it('rejects queued work after close', async () => {
    const pool = new WorkerPool({ size: 1, entry: handler, exportName: 'square' })
    await pool.close()
    await expect(pool.execute(1, ctx(), 5_000)).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('rejects an invalid pool size', () => {
    expect(() => new WorkerPool({ size: 0, entry: handler })).toThrow(PipelineWorkerError)
  })
})

describe('worker stages', () => {
  it('runs CPU work across threads and saturates them', async () => {
    const result = await runPipeline<{ id: number, spinMs: number }>({
      runId: 'worker-stage',
      stages: [
        {
          name: 'cpu',
          worker: { entry: handler, export: 'busyUntil' },
          concurrency: 2,
          items: [
            { id: 1, spinMs: 25 },
            { id: 2, spinMs: 25 },
            { id: 3, spinMs: 25 },
            { id: 4, spinMs: 25 },
          ],
          key: item => String(item.id),
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(result.stages[0]).toMatchObject({ succeeded: 4 })
  })

  it('records worker failures and keeps the stage partial', async () => {
    const result = await runPipeline<string>({
      runId: 'worker-fail',
      stages: [
        {
          name: 'work',
          worker: { entry: handler, export: 'fail' },
          items: ['a', 'b'],
          concurrency: 1,
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0]?.error.message).toContain('worker rejected')
  })

  it('timeouts terminate the worker and fail the item', async () => {
    const result = await runPipeline<number>({
      runId: 'worker-timeout',
      stages: [
        {
          name: 'slow',
          worker: { entry: handler, export: 'busyUntil' },
          items: [
            { id: 1, spinMs: 5_000 },
          ] as never,
          timeoutMs: 30,
          key: () => 'one',
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.failures[0]?.error.code).toBe('TIMEOUT')
  })

  it('requires an absolute worker entry', async () => {
    await expect(runPipeline({
      runId: 'worker-relative',
      stages: [
        {
          name: 'x',
          items: [],
          worker: { entry: 'handler.ts' },
        },
      ],
    })).rejects.toBeInstanceOf(PipelineConfigError)
  })

  it('persists worker item results like inline stages', async () => {
    const store = createMemoryPipelineStore()
    await runPipeline({
      runId: 'worker-persist',
      store,
      stages: [
        {
          name: 'squares',
          worker: { entry: handler, export: 'square' },
          items: [2, 3],
          key: item => String(item),
        },
      ],
    })

    const snapshot = store.peek('worker-persist')
    expect(snapshot?.status).toBe('succeeded')
    expect(snapshot?.stages.squares?.items).toMatchObject({
      2: { status: 'succeeded' },
      3: { status: 'succeeded' },
    })
  })
})

function ctx() {
  return {
    stage: 'test',
    key: 'k',
    attempt: 1,
    maxAttempts: 1,
  }
}
