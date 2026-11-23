/**
 * Pipeline runner.
 *
 * Stages run in declaration order; items inside a stage run with bounded
 * concurrency. Every stage and item change goes through the state machine in
 * `state.ts` and is mirrored into a snapshot that the store persists, which is
 * what makes an interrupted run resumable.
 *
 * Design choices worth knowing:
 * - Items are materialized before dispatch so keys can be validated and resume
 *   is deterministic; the snapshot is already O(items), so this adds no order.
 * - The snapshot is written on transitions but throttled, then flushed at run
 *   boundaries; a crash loses at most one interval of progress.
 * - In-process timeouts abort the handler's signal and reject the attempt; a
 *   handler that ignores the signal keeps running. Worker timeouts terminate the
 *   thread, which is the only real hard stop.
 * - A store write failure fails the run: silently continuing would promise
 *   durability the pipeline cannot deliver.
 */
import type { ItemStatus, StageStatus } from './state'
import type {
  ItemContext,
  ItemFailure,
  ItemSnapshot,
  PipelineEvent,
  PipelineFailure,
  PipelineResult,
  PipelineSnapshot,
  PipelineStore,
  RunPipelineOptions,
  StageCounters,
  StageDefinition,
  StageItems,
  StageResult,
  StageSnapshot,
  WorkerItemContext,
} from './types'
import { isAbsolute } from 'node:path'
import { PipelineCancelledError, PipelineConfigError, PipelineStoreError, PipelineTimeoutError } from './errors'
import {
  assertItemTransition,
  assertStageTransition,
  resumeItemStatus,
  resumeStageStatus,
} from './state'
import { validateRunId } from './store'
import { WorkerPool } from './worker-pool'

const DEFAULT_CONCURRENCY = 4
const DEFAULT_PERSIST_INTERVAL_MS = 1000

interface ResolvedStage<T> {
  definition: StageDefinition<T>
  concurrency: number
  maxAttempts: number
  workerEntry?: string
}

interface Entry<T> {
  item: T
  key: string
}

interface StageRunInput<T> {
  stage: ResolvedStage<T>
  snapshot: PipelineSnapshot
  stageSnapshot: StageSnapshot
  external: AbortSignal
  failures: ItemFailure[]
  emit: (event: PipelineEvent) => void
  save: () => void
  saveThrottled: () => void
}

/** Run every stage; resolve with the aggregate result instead of throwing on item failures. */
export async function runPipeline<T = unknown>(options: RunPipelineOptions<T>): Promise<PipelineResult> {
  validateRunId(options.runId)
  const stages = resolveStages(options.stages)
  const startedAt = Date.now()
  const persistIntervalMs = options.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS
  const external = options.signal ?? new AbortController().signal

  const snapshot = options.resume && options.store
    ? await loadResume(options.store, options.runId, stages)
    : createSnapshot(options.runId, stages)

  let lastPersist = 0
  let persistError: PipelineStoreError | undefined

  const save = (): void => {
    if (!options.store)
      return
    lastPersist = Date.now()
    options.store.save(snapshot).catch((error) => {
      persistError ??= error instanceof PipelineStoreError
        ? error
        : new PipelineStoreError(
            `Failed to persist run ${options.runId}: ${error instanceof Error
              ? error.message
              : String(error)}`,
            {
              context: { runId: options.runId },
              cause: error,
            },
          )
    })
  }

  const saveThrottled = (): void => {
    if (Date.now() - lastPersist >= persistIntervalMs)
      save()
  }

  const flush = async (): Promise<void> => {
    save()
    await options.store?.flush?.()
    if (persistError)
      throw persistError
  }

  const emit = (event: PipelineEvent): void => {
    try {
      options.onEvent?.(event)
    }
    catch {
      // A progress callback must never change the run result.
    }
  }

  const stageResults: StageResult[] = []
  const failures: ItemFailure[] = []

  try {
    for (const stage of stages) {
      const stageSnapshot = snapshot.stages[stage.definition.name] as StageSnapshot
      const stageStart = Date.now()

      if (stageSnapshot.status === 'skipped') {
        stageResults.push({
          name: stage.definition.name,
          status: 'skipped',
          durationMs: 0,
          ...countItems(stageSnapshot),
        })
        continue
      }

      if (external.aborted) {
        transitionStage(snapshot, stageSnapshot, 'cancelled', emit)
        stageSnapshot.finishedAt = new Date().toISOString()
        stageResults.push({
          name: stage.definition.name,
          status: 'cancelled',
          durationMs: 0,
          ...countItems(stageSnapshot),
        })
        continue
      }

      transitionStage(snapshot, stageSnapshot, 'running', emit)
      stageSnapshot.startedAt = new Date().toISOString()
      save()

      const phaseFailures: ItemFailure[] = []
      await runStage({
        stage,
        snapshot,
        stageSnapshot,
        external,
        failures: phaseFailures,
        emit,
        save,
        saveThrottled,
      })

      const status = stageOutcome(stageSnapshot, external, phaseFailures.length > 0)
      transitionStage(snapshot, stageSnapshot, status, emit)
      stageSnapshot.finishedAt = new Date().toISOString()
      failures.push(...phaseFailures)
      stageResults.push({
        name: stage.definition.name,
        status,
        durationMs: Date.now() - stageStart,
        ...countItems(stageSnapshot),
      })
      await flush()
    }

    const status = runOutcome(stageResults, external)
    snapshot.status = status
    snapshot.updatedAt = new Date().toISOString()
    await flush()

    return {
      runId: options.runId,
      status,
      exitCode: status === 'succeeded'
        ? 0
        : 1,
      durationMs: Date.now() - startedAt,
      stages: stageResults,
      failures,
    }
  }
  catch (error) {
    // A store failure or a configuration error aborts the run; still try to
    // leave a `failed` snapshot behind so the next resume can continue.
    snapshot.status = 'failed'
    snapshot.updatedAt = new Date().toISOString()
    await Promise.resolve(options.store?.save(snapshot))
      .catch(() => {})
    await Promise.resolve(options.store?.flush?.())
      .catch(() => {})
    throw error
  }
}

async function runStage<T>(input: StageRunInput<T>): Promise<void> {
  const { stage, stageSnapshot, snapshot, external } = input
  const entries = await materialize(stage, stageSnapshot)
  const pending = entries.filter(entry => (stageSnapshot.items[entry.key] as ItemSnapshot).status === 'pending')

  let nextIndex = 0
  let stopped = false
  const width = Math.max(1, Math.min(stage.concurrency, pending.length || 1))
  // Nothing to dispatch (fully resumed stage): `items()` still ran so stale keys
  // could be pruned, but spawning threads here would only cost startup time.
  const pool = stage.workerEntry && pending.length > 0
    ? new WorkerPool({
        size: width,
        entry: stage.workerEntry,
        exportName: stage.definition.worker?.export ?? 'run',
      })
    : undefined

  const runItem = async (entry: Entry<T>): Promise<void> => {
    const item = stageSnapshot.items[entry.key] as ItemSnapshot
    for (let attempt = item.attempts + 1; attempt <= stage.maxAttempts; attempt += 1) {
      if (external.aborted) {
        transitionItem(snapshot, stageSnapshot, item, 'cancelled', input.emit, attempt)
        return
      }

      transitionItem(snapshot, stageSnapshot, item, 'running', input.emit, attempt)
      item.attempts = attempt
      item.startedAt ??= new Date().toISOString()
      delete item.error
      input.saveThrottled()

      try {
        await executeAttempt({
          stage,
          item: entry.item,
          key: entry.key,
          attempt,
          signal: external,
          pool,
        })
        transitionItem(snapshot, stageSnapshot, item, 'succeeded', input.emit, attempt)
        item.finishedAt = new Date().toISOString()
        input.saveThrottled()
        return
      }
      catch (error) {
        if (external.aborted) {
          transitionItem(snapshot, stageSnapshot, item, 'cancelled', input.emit, attempt)
          return
        }
        if (attempt < stage.maxAttempts) {
          transitionItem(snapshot, stageSnapshot, item, 'pending', input.emit, attempt)
          continue
        }
        transitionItem(snapshot, stageSnapshot, item, 'failed', input.emit, attempt)
        item.finishedAt = new Date().toISOString()
        item.error = serializeFailure(error)
        input.failures.push({
          stage: stage.definition.name,
          key: entry.key,
          error: item.error,
        })
        input.saveThrottled()
        if (stage.definition.failFast)
          stopped = true
        return
      }
    }
  }

  const lane = async (): Promise<void> => {
    for (;;) {
      if (stopped || external.aborted)
        return
      const index = nextIndex
      nextIndex += 1
      const entry = pending[index]
      if (!entry)
        return
      await runItem(entry)
    }
  }

  try {
    await Promise.all(Array.from({ length: width }, lane))
  }
  finally {
    await pool?.close()
  }

  for (const entry of pending) {
    const item = stageSnapshot.items[entry.key] as ItemSnapshot
    if (item.status === 'pending' && external.aborted)
      transitionItem(snapshot, stageSnapshot, item, 'cancelled', input.emit, item.attempts)
  }
}

async function executeAttempt<T>(input: {
  stage: ResolvedStage<T>
  item: T
  key: string
  attempt: number
  signal: AbortSignal
  pool?: WorkerPool
}): Promise<unknown> {
  const { stage, key, attempt, signal } = input
  const base: Omit<ItemContext, 'signal'> = {
    stage: stage.definition.name,
    key,
    attempt,
    maxAttempts: stage.maxAttempts,
  }

  if (stage.workerEntry) {
    const workerCtx: WorkerItemContext = base
    return await raceAbort(
      input.pool!.execute(input.item, workerCtx, stage.definition.timeoutMs),
      signal,
      () => cancelled(stage.definition.name, key, attempt),
    )
  }

  return await runInline(stage, input.item, base, signal)
}

function runInline<T>(
  stage: ResolvedStage<T>,
  item: T,
  base: Omit<ItemContext, 'signal'>,
  external: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const forward = (): void => controller.abort(external.reason)
  if (external.aborted)
    forward()
  else external.addEventListener('abort', forward, { once: true })

  const timeoutMs = stage.definition.timeoutMs
  const timer = timeoutMs
    ? setTimeout(() => {
        controller.abort(new PipelineTimeoutError(
          `Item ${base.key} of stage ${base.stage} exceeded ${timeoutMs}ms`,
          {
            context: {
              stage: base.stage,
              key: base.key,
              attempt: base.attempt,
              timeoutMs,
            },
          },
        ))
      }, timeoutMs)
    : undefined
  timer?.unref?.()

  const work = Promise.resolve().then(() => stage.definition.run!(item, { ...base, signal: controller.signal }))
  return raceAbort(work, controller.signal, () => cancelled(base.stage, base.key, base.attempt))
    .finally(() => {
      if (timer)
        clearTimeout(timer)
      external.removeEventListener('abort', forward)
    })
}

/**
 * Settle with `work`, unless `signal` aborts first.
 *
 * Both handlers are attached, so a late rejection from a timed-out attempt is
 * observed instead of becoming an unhandled rejection.
 */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal, fallback: () => Error): Promise<T> {
  if (signal.aborted)
    return Promise.reject(signal.reason ?? fallback())

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? fallback())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function cancelled(stage: string, key: string, attempt?: number): PipelineCancelledError {
  return new PipelineCancelledError(`Item ${key} of stage ${stage} was cancelled`, {
    context: {
      stage,
      key,
      ...(attempt === undefined
        ? {}
        : { attempt }),
    },
  })
}

/**
 * Materialize items, validate keys and register new snapshot entries.
 *
 * Runs only for stages that execute, so a resumed stage does not re-enumerate.
 * Entries missing from the enumeration are pruned: `items()` must be
 * deterministic for a given `runId`, and stale keys would skew the counters.
 */
async function materialize<T>(stage: ResolvedStage<T>, stageSnapshot: StageSnapshot): Promise<Entry<T>[]> {
  const seen = new Set<string>()
  const entries: Entry<T>[] = []
  let index = 0

  for await (const item of iterate<T>(stage.definition.items)) {
    const key = stage.definition.key
      ? stage.definition.key(item, index)
      : defaultKey(item)
    if (typeof key !== 'string' || key.length === 0) {
      throw new PipelineConfigError(`Stage ${stage.definition.name} produced an invalid key at index ${index}`, {
        context: { stage: stage.definition.name, index },
      })
    }
    if (seen.has(key)) {
      throw new PipelineConfigError(
        `Stage ${stage.definition.name} produced duplicate key ${JSON.stringify(key)}; keys must be unique`,
        {
          context: { stage: stage.definition.name, key, index },
        },
      )
    }
    seen.add(key)
    index += 1

    stageSnapshot.items[key] ??= {
      key,
      status: 'pending',
      attempts: 0,
    }
    entries.push({ item, key })
  }

  for (const key of Object.keys(stageSnapshot.items)) {
    if (!seen.has(key))
      delete stageSnapshot.items[key]
  }

  return entries
}

async function* iterate<T>(source: StageItems<T>): AsyncGenerator<T> {
  const resolved = await source
  if (Symbol.asyncIterator in (resolved as object)) {
    for await (const item of resolved as AsyncIterable<T>) yield item
    return
  }
  for (const item of resolved as Iterable<T>) yield item
}

function defaultKey(item: unknown): string {
  const serialized = JSON.stringify(item)
  return serialized === undefined
    ? String(item)
    : serialized
}

function createSnapshot<T>(runId: string, stages: ResolvedStage<T>[]): PipelineSnapshot {
  const now = new Date().toISOString()
  const snapshot: PipelineSnapshot = {
    version: 1,
    runId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    stages: {},
  }
  for (const stage of stages) {
    snapshot.stages[stage.definition.name] = {
      name: stage.definition.name,
      status: 'idle',
      items: {},
    }
  }
  return snapshot
}

async function loadResume<T>(
  store: PipelineStore,
  runId: string,
  stages: ResolvedStage<T>[],
): Promise<PipelineSnapshot> {
  const previous = await store.load(runId)
  if (!previous)
    return createSnapshot(runId, stages)

  // A stage removed from the definition must not linger in the snapshot: the
  // next consumer would see progress for work that no longer exists.
  const declared = new Set(stages.map(stage => stage.definition.name))
  for (const name of Object.keys(previous.stages)) {
    if (!declared.has(name))
      delete previous.stages[name]
  }

  for (const stage of stages) {
    const stored = previous.stages[stage.definition.name]
    if (!stored) {
      previous.stages[stage.definition.name] = {
        name: stage.definition.name,
        status: 'idle',
        items: {},
      }
      continue
    }
    stored.status = resumeStageStatus(stored.status)
    if (stored.status === 'idle') {
      delete stored.startedAt
      delete stored.finishedAt
    }
    for (const item of Object.values(stored.items)) {
      item.status = resumeItemStatus(item.status)
      delete item.startedAt
      delete item.finishedAt
      delete item.error
      if (item.status === 'pending')
        item.attempts = 0
    }
  }

  previous.status = 'running'
  previous.updatedAt = new Date().toISOString()
  return previous
}

function transitionStage(
  snapshot: PipelineSnapshot,
  stage: StageSnapshot,
  to: StageStatus,
  emit: (event: PipelineEvent) => void,
): void {
  assertStageTransition(stage.status, to)
  const from = stage.status
  stage.status = to
  snapshot.updatedAt = new Date().toISOString()
  emit({
    kind: 'stage',
    stage: stage.name,
    from,
    to,
  })
}

function transitionItem(
  snapshot: PipelineSnapshot,
  stage: StageSnapshot,
  item: ItemSnapshot,
  to: ItemStatus,
  emit: (event: PipelineEvent) => void,
  attempt: number,
): void {
  assertItemTransition(item.status, to)
  const from = item.status
  item.status = to
  snapshot.updatedAt = new Date().toISOString()
  emit({
    kind: 'item',
    stage: stage.name,
    key: item.key,
    from,
    to,
    attempt,
  })
}

function countItems(stage: StageSnapshot): StageCounters {
  const totals: Record<ItemStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  }
  for (const item of Object.values(stage.items)) totals[item.status] += 1
  return {
    succeeded: totals.succeeded,
    failed: totals.failed,
    skipped: totals.skipped,
    cancelled: totals.cancelled,
    pending: totals.pending + totals.running,
  }
}

function stageOutcome(
  stage: StageSnapshot,
  external: AbortSignal,
  hasFailures: boolean,
): Exclude<StageStatus, 'idle' | 'running'> {
  if (external.aborted)
    return 'cancelled'
  const counters = countItems(stage)
  if (hasFailures || counters.failed > 0) {
    return counters.succeeded + counters.skipped > 0
      ? 'partial'
      : 'failed'
  }
  if (counters.cancelled > 0)
    return 'cancelled'
  if (counters.pending > 0)
    return 'partial'
  return 'succeeded'
}

function runOutcome(
  stages: StageResult[],
  external: AbortSignal,
): Exclude<PipelineSnapshot['status'], 'running'> {
  if (external.aborted)
    return 'cancelled'
  if (stages.some(stage => stage.status === 'failed'))
    return 'failed'
  if (stages.some(stage => stage.status === 'partial'))
    return 'partial'
  if (stages.some(stage => stage.status === 'cancelled'))
    return 'cancelled'
  return 'succeeded'
}

function serializeFailure(error: unknown): PipelineFailure {
  if (error instanceof Error) {
    const code = 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
    return {
      message: error.message,
      ...(code
        ? { code }
        : {}),
      ...(error.stack
        ? { stack: error.stack }
        : {}),
    }
  }
  return {
    message: String(error),
  }
}

function resolveStages<T>(definitions: readonly StageDefinition<T>[]): ResolvedStage<T>[] {
  if (definitions.length === 0)
    throw new PipelineConfigError('A pipeline needs at least one stage')

  const names = new Set<string>()
  return definitions.map((definition) => {
    if (!definition.name || definition.name.trim().length === 0)
      throw new PipelineConfigError('Every stage needs a non-empty name')
    if (names.has(definition.name))
      throw new PipelineConfigError(`Duplicate stage name ${definition.name}`)
    names.add(definition.name)

    const hasRun = typeof definition.run === 'function'
    const hasWorker = definition.worker !== undefined
    if (hasRun === hasWorker) {
      throw new PipelineConfigError(
        `Stage ${definition.name} must define exactly one of run / worker`,
        {
          context: { stage: definition.name },
        },
      )
    }

    let workerEntry: string | undefined
    if (definition.worker) {
      const entry = definition.worker.entry
      if (!entry || (!isAbsolute(entry) && !entry.startsWith('file:'))) {
        throw new PipelineConfigError(
          `Stage ${definition.name} worker entry must be an absolute path or file: URL, received ${JSON.stringify(entry)}`,
          {
            context: { stage: definition.name, entry },
          },
        )
      }
      workerEntry = entry
    }

    const concurrency = definition.concurrency ?? DEFAULT_CONCURRENCY
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new PipelineConfigError(`Stage ${definition.name} concurrency must be a positive integer`, {
        context: { stage: definition.name, concurrency },
      })
    }

    const retries = definition.retries ?? 0
    if (!Number.isInteger(retries) || retries < 0) {
      throw new PipelineConfigError(`Stage ${definition.name} retries must be a non-negative integer`, {
        context: { stage: definition.name, retries },
      })
    }

    if (definition.timeoutMs !== undefined && (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)) {
      throw new PipelineConfigError(`Stage ${definition.name} timeoutMs must be a positive number`, {
        context: { stage: definition.name, timeoutMs: definition.timeoutMs },
      })
    }

    return {
      definition,
      concurrency,
      maxAttempts: retries + 1,
      workerEntry,
    }
  })
}
