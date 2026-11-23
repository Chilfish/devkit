/**
 * Snapshot persistence.
 *
 * `createFilePipelineStore` writes one JSON file per run with a temp-file +
 * rename, so a crash never leaves a half-written snapshot. Writes inside the
 * flush window are coalesced: only the latest state between two writes hits
 * the disk, which keeps per-item saves cheap.
 *
 * `save` serializes the snapshot synchronously, so a later mutation of the
 * caller's object cannot change what gets written.
 */
import type { PipelineSnapshot, PipelineStore } from './types'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PipelineStoreError } from './errors'

const RUN_ID_PATTERN = /^[A-Z0-9][\w.-]*$/i
const MAX_RUN_ID_LENGTH = 128

/** Reject ids that would escape the store directory or break the file name. */
export function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId) || runId.length > MAX_RUN_ID_LENGTH) {
    throw new PipelineStoreError(
      `Invalid runId: ${JSON.stringify(runId)}; use ${MAX_RUN_ID_LENGTH} characters or fewer from [A-Za-z0-9._-]`,
      {
        context: { runId },
      },
    )
  }
}

export interface FilePipelineStoreOptions {
  /** Directory holding `<runId>.json` snapshots. */
  dir: string
  /** Coalescing window in milliseconds. Defaults to 200. */
  flushIntervalMs?: number
}

/** Store that survives the process; resume reads the last written snapshot. */
export function createFilePipelineStore(options: FilePipelineStoreOptions): PipelineStore {
  const dir = options.dir
  const flushIntervalMs = options.flushIntervalMs ?? 200

  const pending = new Map<string, { payload: string, waiters: Waiter[] }>()
  let timer: NodeJS.Timeout | undefined
  let writing: Promise<void> | undefined
  let tempCounter = 0

  async function writeAtomic(runId: string, payload: string): Promise<void> {
    await mkdir(dir, { recursive: true })
    tempCounter += 1
    const target = join(dir, `${runId}.json`)
    const temp = join(dir, `.${runId}.${process.pid}.${tempCounter}.tmp`)
    await writeFile(temp, payload, 'utf8')
    await rename(temp, target)
  }

  function drain(): Promise<void> {
    if (writing)
      return writing

    writing = (async () => {
      try {
        while (pending.size > 0) {
          const batch = [...pending]
          pending.clear()
          const results = await Promise.allSettled(
            batch.map(async ([runId, entry]) => {
              try {
                await writeAtomic(runId, entry.payload)
                for (const waiter of entry.waiters) waiter.resolve()
              }
              catch (error) {
                const failure = new PipelineStoreError(`Failed to write snapshot for run ${runId}`, {
                  context: { runId },
                  cause: error,
                })
                for (const waiter of entry.waiters) waiter.reject(failure)
                throw failure
              }
            }),
          )
          const rejected = results.find(result => result.status === 'rejected')
          if (rejected && rejected.status === 'rejected')
            throw rejected.reason
        }
      }
      finally {
        writing = undefined
      }
    })()
    return writing
  }

  function schedule(): void {
    if (timer || writing)
      return
    timer = setTimeout(() => {
      timer = undefined
      void drain().catch(() => {
        // Waiters already received the rejection; an unobserved loop must not
        // become an unhandled rejection.
      })
    }, flushIntervalMs)
    timer.unref?.()
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    await drain()
  }

  return {
    async load(runId) {
      validateRunId(runId)
      const path = join(dir, `${runId}.json`)
      let content: string
      try {
        content = await readFile(path, 'utf8')
      }
      catch (error) {
        if (isMissing(error))
          return undefined
        throw new PipelineStoreError(`Failed to read snapshot ${path}`, {
          context: { runId, path },
          cause: error,
        })
      }

      try {
        const parsed = JSON.parse(content) as PipelineSnapshot
        if (!isSnapshot(parsed, runId)) {
          throw new PipelineStoreError(`Snapshot ${path} is not a version 1 pipeline snapshot for ${runId}`, {
            code: 'CORRUPT_SNAPSHOT',
            context: { runId, path },
          })
        }
        return parsed
      }
      catch (error) {
        if (error instanceof PipelineStoreError)
          throw error
        throw new PipelineStoreError(`Snapshot ${path} is not valid JSON`, {
          code: 'CORRUPT_SNAPSHOT',
          context: { runId, path },
          cause: error,
        })
      }
    },

    async save(snapshot) {
      // `async` so an invalid run id rejects instead of throwing synchronously.
      validateRunId(snapshot.runId)
      const payload = JSON.stringify(snapshot)
      await new Promise<void>((resolve, reject) => {
        const entry = pending.get(snapshot.runId)
        if (entry) {
          entry.payload = payload
          entry.waiters.push({ resolve, reject })
        }
        else {
          pending.set(snapshot.runId, {
            payload,
            waiters: [
              { resolve, reject },
            ],
          })
        }
        schedule()
      })
    },

    flush,
  }
}

interface Waiter {
  resolve: () => void
  reject: (error: unknown) => void
}

/** In-memory store for tests and examples; `structuredClone` emulates a disk round-trip. */
export function createMemoryPipelineStore(): PipelineStore & { peek: (runId: string) => PipelineSnapshot | undefined } {
  const snapshots = new Map<string, PipelineSnapshot>()
  return {
    async load(runId) {
      validateRunId(runId)
      const stored = snapshots.get(runId)
      return stored
        ? structuredClone(stored)
        : undefined
    },
    async save(snapshot) {
      validateRunId(snapshot.runId)
      snapshots.set(snapshot.runId, structuredClone(snapshot))
    },
    peek(runId) {
      const stored = snapshots.get(runId)
      return stored
        ? structuredClone(stored)
        : undefined
    },
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isSnapshot(value: unknown, runId: string): value is PipelineSnapshot {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as Partial<PipelineSnapshot>
  return candidate.version === 1
    && candidate.runId === runId
    && typeof candidate.stages === 'object'
    && candidate.stages !== null
    && typeof candidate.status === 'string'
}
