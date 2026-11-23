import type { PipelineEvent, StageDefinition } from '../../src/pipeline/types'
import { describe, expect, it, vi } from 'vitest'
import {
  PipelineCancelledError,
  PipelineConfigError,
} from '../../src/pipeline/errors'
import { runPipeline } from '../../src/pipeline/runner'
import { createMemoryPipelineStore } from '../../src/pipeline/store'
import { createConcurrencyProbe, delay } from './fixtures'

describe('runPipeline', () => {
  it('runs every item and reports success', async () => {
    const seen: number[] = []
    const result = await runPipeline({
      runId: 'ok',
      stages: [
        {
          name: 'work',
          items: [1, 2, 3],
          run(item) {
            seen.push(item)
          },
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(result.exitCode).toBe(0)
    expect(seen.sort()).toEqual([1, 2, 3])
    expect(result.stages[0]).toMatchObject({
      name: 'work',
      status: 'succeeded',
      succeeded: 3,
      failed: 0,
    })
  })

  it('never exceeds the concurrency ceiling', async () => {
    const probe = createConcurrencyProbe()
    const result = await runPipeline({
      runId: 'bounded',
      stages: [
        {
          name: 'work',
          items: Array.from({ length: 12 }, (_, index) => index),
          concurrency: 3,
          run: () => probe.run(() => delay(5)),
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(probe.peak).toBeLessThanOrEqual(3)
    expect(probe.peak).toBeGreaterThan(1)
  })

  it('retries a failing item and succeeds on a later attempt', async () => {
    const attempts: Record<string, number> = {}
    const result = await runPipeline({
      runId: 'retry',
      stages: [
        {
          name: 'flaky',
          items: ['a', 'b'],
          retries: 2,
          run(item, ctx) {
            attempts[item] = (attempts[item] ?? 0) + 1
            if (item === 'a' && ctx.attempt < 3)
              throw new Error(`attempt ${ctx.attempt}`)
          },
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(attempts.a).toBe(3)
    expect(attempts.b).toBe(1)
  })

  it('aggregates failures and keeps running the rest of the stage', async () => {
    const ran: string[] = []
    const result = await runPipeline({
      runId: 'partial',
      stages: [
        {
          name: 'mixed',
          items: ['ok-1', 'bad', 'ok-2'],
          concurrency: 1,
          run(item) {
            ran.push(item)
            if (item === 'bad')
              throw new Error('boom')
          },
        },
      ],
    })

    expect(result.status).toBe('partial')
    expect(result.exitCode).toBe(1)
    expect(ran).toEqual(['ok-1', 'bad', 'ok-2'])
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: 'mixed',
        key: '"bad"',
        error: expect.objectContaining({ message: 'boom' }),
      }),
    ])
    expect(result.stages[0]).toMatchObject({ status: 'partial', succeeded: 2, failed: 1 })
  })

  it('marks the stage failed when every item fails', async () => {
    const result = await runPipeline({
      runId: 'all-fail',
      stages: [
        {
          name: 'doomed',
          items: [1, 2],
          run() {
            throw new Error('nope')
          },
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.stages[0]).toMatchObject({ status: 'failed', failed: 2 })
  })

  it('stops dispatching after a failure when failFast is set', async () => {
    const ran: number[] = []
    const result = await runPipeline({
      runId: 'fail-fast',
      stages: [
        {
          name: 'stop',
          items: [1, 2, 3, 4],
          concurrency: 1,
          failFast: true,
          run(item) {
            ran.push(item)
            if (item === 2)
              throw new Error('stop here')
          },
        },
      ],
    })

    expect(ran).toEqual([1, 2])
    expect(result.status).toBe('partial')
    expect(result.stages[0]).toMatchObject({ succeeded: 1, failed: 1, pending: 2 })
  })

  it('aborts pending work when the signal fires', async () => {
    const controller = new AbortController()
    const ran: number[] = []
    const result = await runPipeline({
      runId: 'cancel',
      signal: controller.signal,
      stages: [
        {
          name: 'long',
          items: [1, 2, 3],
          concurrency: 1,
          async run(item) {
            ran.push(item)
            if (item === 1)
              controller.abort()
            await delay(5)
          },
        },
      ],
    })

    expect(result.status).toBe('cancelled')
    expect(ran).toEqual([1])
    // The in-flight item and the two never-dispatched items all end cancelled.
    expect(result.stages[0]).toMatchObject({ status: 'cancelled', cancelled: 3 })
  })

  it('skips items and stages already completed when resuming', async () => {
    const store = createMemoryPipelineStore()
    const first = await runPipeline({
      runId: 'resume',
      store,
      stages: [
        {
          name: 'one',
          items: ['a', 'b'],
          run() {},
        },
      ],
    })
    expect(first.status).toBe('succeeded')

    const calls: string[] = []
    const second = await runPipeline({
      runId: 'resume',
      store,
      resume: true,
      stages: [
        {
          name: 'one',
          items: ['a', 'b'],
          run(item) {
            calls.push(item)
          },
        },
        {
          name: 'two',
          items: ['c'],
          run(item) {
            calls.push(item)
          },
        },
      ],
    })

    expect(calls).toEqual(['c'])
    expect(second.status).toBe('succeeded')
    expect(second.stages[0]).toMatchObject({ name: 'one', status: 'skipped', skipped: 2 })
    expect(second.stages[1]).toMatchObject({ name: 'two', status: 'succeeded', succeeded: 1 })
  })

  it('re-runs failed and interrupted items on resume', async () => {
    const store = createMemoryPipelineStore()
    const failing = await runPipeline({
      runId: 'resume-failed',
      store,
      stages: [
        {
          name: 'work',
          items: ['good', 'bad'],
          run(item) {
            if (item === 'bad')
              throw new Error('first pass fails')
          },
        },
      ],
    })
    expect(failing.status).toBe('partial')

    const calls: string[] = []
    const second = await runPipeline({
      runId: 'resume-failed',
      store,
      resume: true,
      stages: [
        {
          name: 'work',
          items: ['good', 'bad'],
          run(item) {
            calls.push(item)
          },
        },
      ],
    })

    expect(calls).toEqual(['bad'])
    expect(second.status).toBe('succeeded')
    expect(second.stages[0]).toMatchObject({ succeeded: 1, skipped: 1, failed: 0 })
  })

  it('starts over when resume is off', async () => {
    const store = createMemoryPipelineStore()
    await runPipeline({
      runId: 'restart',
      store,
      stages: [
        {
          name: 'work',
          items: ['a'],
          run() {},
        },
      ],
    })

    const calls: string[] = []
    await runPipeline({
      runId: 'restart',
      store,
      stages: [
        {
          name: 'work',
          items: ['a'],
          run(item) {
            calls.push(item)
          },
        },
      ],
    })

    expect(calls).toEqual(['a'])
  })

  it('emits stage and item transitions', async () => {
    const events: PipelineEvent[] = []
    await runPipeline({
      runId: 'events',
      onEvent: event => events.push(event),
      stages: [
        {
          name: 'work',
          items: ['a'],
          retries: 1,
          run() {},
        },
      ],
    })

    expect(events).toContainEqual({
      kind: 'stage',
      stage: 'work',
      from: 'idle',
      to: 'running',
    })
    expect(events).toContainEqual({
      kind: 'item',
      stage: 'work',
      key: '"a"',
      from: 'pending',
      to: 'running',
      attempt: 1,
    })
    expect(events).toContainEqual({
      kind: 'item',
      stage: 'work',
      key: '"a"',
      from: 'running',
      to: 'succeeded',
      attempt: 1,
    })
    expect(events).toContainEqual({
      kind: 'stage',
      stage: 'work',
      from: 'running',
      to: 'succeeded',
    })
  })

  it('persists progress to the store', async () => {
    const store = createMemoryPipelineStore()
    await runPipeline({
      runId: 'persist',
      store,
      stages: [
        {
          name: 'work',
          items: ['a', 'b'],
          run() {},
        },
      ],
    })

    const snapshot = store.peek('persist')
    expect(snapshot).toMatchObject({ runId: 'persist', status: 'succeeded', version: 1 })
    expect(snapshot?.stages.work?.items).toMatchObject({
      '"a"': { status: 'succeeded', attempts: 1 },
      '"b"': { status: 'succeeded', attempts: 1 },
    })
  })

  it('supports async iterables and custom keys', async () => {
    async function* generate(): AsyncGenerator<{ id: string }> {
      yield { id: 'x' }
      yield { id: 'y' }
    }
    const keys: string[] = []
    const result = await runPipeline({
      runId: 'async-items',
      stages: [
        {
          name: 'work',
          items: generate(),
          key: item => item.id,
          run(item, ctx) {
            keys.push(ctx.key)
          },
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(keys.sort()).toEqual(['x', 'y'])
  })

  it('rejects a pipeline without stages', async () => {
    await expect(runPipeline({ runId: 'empty', stages: [] })).rejects.toBeInstanceOf(PipelineConfigError)
  })

  it('rejects a stage with both run and worker', async () => {
    const stage = {
      name: 'both',
      items: [] as number[],
      run() {},
      worker: { entry: '/abs/handler.js' },
    } satisfies StageDefinition<number>

    await expect(runPipeline({
      runId: 'both',
      stages: [stage],
    })).rejects.toThrow(/exactly one of run \/ worker/)
  })

  it('rejects duplicate stage names', async () => {
    await expect(runPipeline({
      runId: 'dupe-stage',
      stages: [
        {
          name: 'same',
          items: [],
          run() {},
        },
        {
          name: 'same',
          items: [],
          run() {},
        },
      ],
    })).rejects.toThrow(/Duplicate stage name/)
  })

  it('rejects duplicate item keys', async () => {
    await expect(runPipeline({
      runId: 'dupe-key',
      stages: [
        {
          name: 'work',
          items: [1, 1],
          key: () => 'same',
          run() {},
        },
      ],
    })).rejects.toThrow(/duplicate key/)
  })

  it('rejects a relative worker entry', async () => {
    await expect(runPipeline({
      runId: 'relative-worker',
      stages: [
        {
          name: 'work',
          items: [],
          worker: { entry: './handler.js' },
        },
      ],
    })).rejects.toThrow(/absolute path or file: URL/)
  })

  it('rejects an invalid concurrency value', async () => {
    await expect(runPipeline({
      runId: 'bad-concurrency',
      stages: [
        {
          name: 'work',
          items: [],
          concurrency: 0,
          run() {},
        },
      ],
    })).rejects.toThrow(/concurrency must be a positive integer/)
  })

  it('turns an inline timeout into a failure', async () => {
    const result = await runPipeline({
      runId: 'timeout',
      stages: [
        {
          name: 'slow',
          items: ['a'],
          timeoutMs: 10,
          run: (_item, ctx) => new Promise((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true })
          }),
        },
      ],
    })

    expect(result.status).toBe('failed')
    expect(result.failures[0]?.error.code).toBe('TIMEOUT')
  })

  it('reports a cancelled error type when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runPipeline({
      runId: 'pre-aborted',
      signal: controller.signal,
      stages: [
        {
          name: 'work',
          items: ['a'],
          run() {},
        },
      ],
    })

    expect(result.status).toBe('cancelled')
    expect(result.stages[0]?.status).toBe('cancelled')
  })

  it('does not let a throwing progress callback break the run', async () => {
    const onEvent = vi.fn(() => {
      throw new Error('callback exploded')
    })
    const result = await runPipeline({
      runId: 'callback',
      onEvent,
      stages: [
        {
          name: 'work',
          items: ['a'],
          run() {},
        },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(onEvent).toHaveBeenCalled()
  })

  it('surfaces store write failures', async () => {
    const store = createMemoryPipelineStore()
    const failing = {
      ...store,
      save: async () => {
        throw new Error('disk full')
      },
    }
    await expect(runPipeline({
      runId: 'store-fail',
      store: failing,
      stages: [
        {
          name: 'work',
          items: ['a'],
          run() {},
        },
      ],
    })).rejects.toThrow(/disk full/)
  })

  it('rejects an invalid runId before running', async () => {
    await expect(runPipeline({
      runId: '../escape',
      stages: [
        {
          name: 'work',
          items: [],
          run() {},
        },
      ],
    })).rejects.toThrow(/Invalid runId/)
  })

  it('cancels in-flight work through the item signal', async () => {
    const controller = new AbortController()
    let sawAbort = false
    const result = await runPipeline({
      runId: 'signal-propagation',
      signal: controller.signal,
      stages: [
        {
          name: 'work',
          items: ['a'],
          async run(_item, ctx) {
            ctx.signal.addEventListener('abort', () => {
              sawAbort = true
            })
            setTimeout(() => controller.abort(new PipelineCancelledError('stop')), 5)
            await delay(50, ctx.signal)
          },
        },
      ],
    })

    expect(sawAbort).toBe(true)
    expect(result.status).toBe('cancelled')
  })
})
