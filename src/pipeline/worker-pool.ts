/**
 * Worker-thread pool for CPU-bound stages.
 *
 * One worker handles exactly one item at a time, so `concurrency` maps to the
 * number of threads. A timeout, a crash or a load failure discards the worker
 * and the next task spawns a replacement; a late reply from a discarded worker
 * can never be attributed to a newer task because replies carry the task id.
 */
import type { WorkerItemContext } from './types'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { PipelineCancelledError, PipelineTimeoutError, PipelineWorkerError } from './errors'

/** Absolute path of the generic worker entry, resolved next to this module. */
export function resolveWorkerEntry(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  for (const name of ['worker-entry.js', 'worker-entry.ts']) {
    const candidate = join(dir, name)
    if (existsSync(candidate))
      return candidate
  }
  throw new PipelineWorkerError(
    `Pipeline worker entry not found next to ${dir}; build the package or run from source`,
    {
      context: { dir },
    },
  )
}

interface PendingTask {
  id: number
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer?: NodeJS.Timeout
}

interface Slot {
  state: 'idle' | 'busy'
  worker?: Worker
  ready?: Promise<void>
  pending?: PendingTask
}

export interface WorkerPoolOptions {
  /** Number of threads; equals the stage concurrency. */
  size: number
  /** Handler module, absolute path or `file:` URL. */
  entry: string
  /** Named export to call. Defaults to `run`. */
  exportName?: string
}

/** Result of a terminated/queued task; the runner maps it to an item status. */
export class WorkerPool {
  readonly #handler: string
  readonly #exportName: string
  readonly #slots: Slot[]
  readonly #queue: { resolve: (slot: Slot) => void, reject: (error: unknown) => void }[] = []
  #closed = false
  #nextId = 1

  constructor(options: WorkerPoolOptions) {
    if (!Number.isInteger(options.size) || options.size < 1)
      throw new PipelineWorkerError(`Worker pool size must be a positive integer, received ${options.size}`)
    this.#handler = isAbsolute(options.entry) || options.entry.startsWith('file:')
      ? options.entry
      : resolve(options.entry)
    this.#exportName = options.exportName ?? 'run'
    this.#slots = Array.from({ length: options.size }, () => ({ state: 'idle' }) as Slot)
  }

  /** Run one item; resolves with the handler return value. */
  async execute(item: unknown, ctx: WorkerItemContext, timeoutMs?: number): Promise<unknown> {
    const slot = await this.#acquire()
    try {
      return await this.#run(slot, item, ctx, timeoutMs)
    }
    finally {
      if (slot.pending === undefined)
        slot.state = 'idle'
      this.#pump()
    }
  }

  /**
   * Stop the pool: reject queued and in-flight tasks with `PipelineCancelledError`
   * and terminate every thread. Idempotent.
   */
  async close(): Promise<void> {
    if (this.#closed)
      return
    this.#closed = true

    const cancellation = new PipelineCancelledError('Worker pool closed')
    for (const entry of this.#queue.splice(0))
      entry.reject(cancellation)

    const exits: Promise<unknown>[] = []
    for (const slot of this.#slots) {
      const worker = slot.worker
      this.#settle(slot, cancellation)
      slot.worker = undefined
      slot.ready = undefined
      if (worker) {
        worker.removeAllListeners()
        exits.push(worker.terminate())
      }
    }
    await Promise.allSettled(exits)
  }

  #acquire(): Promise<Slot> {
    if (this.#closed)
      return Promise.reject(new PipelineCancelledError('Worker pool closed'))
    return new Promise<Slot>((resolveSlot, rejectSlot) => {
      this.#queue.push({ resolve: resolveSlot, reject: rejectSlot })
      this.#pump()
    })
  }

  #pump(): void {
    if (this.#closed)
      return
    while (this.#queue.length > 0) {
      const slot = this.#slots.find(candidate => candidate.state === 'idle')
      if (!slot)
        return
      const next = this.#queue.shift()
      if (!next)
        return
      slot.state = 'busy'
      next.resolve(slot)
    }
  }

  async #run(slot: Slot, item: unknown, ctx: WorkerItemContext, timeoutMs?: number): Promise<unknown> {
    await this.#ensureStarted(slot)
    const worker = slot.worker
    if (!worker)
      throw new PipelineWorkerError(`Worker for ${this.#handler} disappeared before running ${ctx.key}`)

    const id = this.#nextId
    this.#nextId += 1

    return await new Promise<unknown>((resolveTask, rejectTask) => {
      const timer = timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            this.#settle(
              slot,
              new PipelineTimeoutError(
                `Item ${ctx.key} of stage ${ctx.stage} exceeded ${timeoutMs}ms`,
                {
                  context: { stage: ctx.stage, key: ctx.key, timeoutMs },
                },
              ),
            )
            this.#discardWorker(slot)
          }, timeoutMs)
        : undefined
      timer?.unref?.()

      slot.pending = {
        id,
        resolve: resolveTask,
        reject: rejectTask,
        timer,
      }

      try {
        worker.postMessage({ type: 'task', id, item, ctx })
      }
      catch (error) {
        this.#settle(slot, new PipelineWorkerError(
          `Item ${ctx.key} of stage ${ctx.stage} is not structured-cloneable`,
          {
            context: { stage: ctx.stage, key: ctx.key },
            cause: error,
          },
        ))
        this.#discardWorker(slot)
      }
    })
  }

  #ensureStarted(slot: Slot): Promise<void> {
    if (slot.worker && slot.ready)
      return slot.ready

    slot.ready = new Promise<void>((resolveReady, rejectReady) => {
      // Spawn the generic worker entry, not the handler module: the handler is
      // an arbitrary user module with named exports, it never owns the message
      // protocol on its own.
      const worker = new Worker(pathToFileURL(resolveWorkerEntry()), {
        workerData: { handler: this.#handler, exportName: this.#exportName },
      })
      slot.worker = worker

      const onInit = (message: WorkerReply): void => {
        if (!message || typeof message !== 'object')
          return
        if (message.type === 'ready') {
          resolveReady()
        }
        else if (message.type === 'init-error') {
          const failure = message.error ?? { message: 'unknown worker init error' }
          rejectReady(new PipelineWorkerError(
            `Worker failed to load ${this.#handler}: ${failure.message}`,
            {
              context: { handler: this.#handler, exportName: this.#exportName },
              cause: failure,
            },
          ))
          this.#discardWorker(slot)
        }
      }

      worker.on('message', (message: WorkerReply) => {
        if (!message || typeof message !== 'object')
          return
        if (message.type === 'ready' || message.type === 'init-error') {
          onInit(message)
          return
        }
        const pending = slot.pending
        if (!pending || message.id !== pending.id)
          return
        if (message.ok) {
          this.#settle(slot, undefined, message.result)
        }
        else {
          const failure = message.error ?? { message: 'unknown worker error' }
          this.#settle(slot, new PipelineWorkerError(
            failure.message,
            {
              code: failure.code ?? 'WORKER',
              context: { handler: this.#handler },
              cause: failure,
            },
          ))
        }
      })

      worker.on('error', (error: Error) => {
        const failure = new PipelineWorkerError(
          `Worker for ${this.#handler} crashed: ${error.message}`,
          {
            context: { handler: this.#handler },
            cause: error,
          },
        )
        rejectReady(failure)
        if (slot.pending)
          this.#settle(slot, failure)
        slot.worker = undefined
        slot.ready = undefined
      })

      worker.on('exit', (code) => {
        if (slot.worker !== worker)
          return
        const failure = new PipelineWorkerError(
          `Worker for ${this.#handler} exited with code ${code}`,
          {
            context: { handler: this.#handler, code },
          },
        )
        rejectReady(failure)
        if (slot.pending)
          this.#settle(slot, failure)
        slot.worker = undefined
        slot.ready = undefined
      })
    })

    return slot.ready
  }

  /** Settle the in-flight task, if any. Clears the timeout. */
  #settle(slot: Slot, error?: unknown, value?: unknown): void {
    const pending = slot.pending
    if (!pending)
      return
    slot.pending = undefined
    if (pending.timer)
      clearTimeout(pending.timer)
    if (error === undefined)
      pending.resolve(value)
    else
      pending.reject(error)
  }

  #discardWorker(slot: Slot): void {
    const worker = slot.worker
    slot.worker = undefined
    slot.ready = undefined
    if (worker) {
      worker.removeAllListeners()
      void worker.terminate()
    }
  }
}

interface WorkerReply {
  type: 'ready' | 'init-error' | 'result'
  id?: number
  ok?: boolean
  result?: unknown
  error?: { message: string, stack?: string, code?: string }
}
