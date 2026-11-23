/**
 * Pipeline data shapes shared by the runner, the store and hosts.
 *
 * The snapshot is the persisted form: plain JSON, no functions and no signals,
 * so it can be written to disk and loaded by a later process.
 */
import type { ItemStatus, PipelineStatus, StageStatus } from './state'

export interface PipelineFailure {
  message: string
  code?: string
  stack?: string
}

export interface ItemSnapshot {
  key: string
  status: ItemStatus
  attempts: number
  startedAt?: string
  finishedAt?: string
  error?: PipelineFailure
}

export interface StageSnapshot {
  name: string
  status: StageStatus
  startedAt?: string
  finishedAt?: string
  items: Record<string, ItemSnapshot>
}

export interface PipelineSnapshot {
  version: 1
  runId: string
  status: PipelineStatus
  startedAt: string
  updatedAt: string
  stages: Record<string, StageSnapshot>
}

/** `flush` is optional: an in-memory test store may omit it. */
export interface PipelineStore {
  load: (runId: string) => Promise<PipelineSnapshot | undefined>
  save: (snapshot: PipelineSnapshot) => Promise<void>
  flush?: () => Promise<void>
}

export interface ItemContext {
  stage: string
  key: string
  /** 1-based attempt number. */
  attempt: number
  maxAttempts: number
  /** Aborted on timeout, cancellation or worker replacement. */
  signal: AbortSignal
}

/** Context sent to a worker thread; the live `AbortSignal` cannot be cloned. */
export type WorkerItemContext = Omit<ItemContext, 'signal'>

export type StageItems<T>
  = | Iterable<T>
    | AsyncIterable<T>
    | PromiseLike<Iterable<T> | AsyncIterable<T>>

export interface WorkerHandler {
  /** Absolute module path (or `file:` URL) exporting the handler. */
  entry: string
  /** Named export to call. Defaults to `run`. */
  export?: string
}

export interface StageDefinition<T = unknown> {
  /** Unique within the run; used as the snapshot key. */
  name: string
  /** Enumerates items; sync or async iterables and promises are accepted. */
  items: StageItems<T>
  /** In-process handler. Exactly one of `run` / `worker` is required. */
  run?: (item: T, ctx: ItemContext) => unknown
  /** Worker-thread handler module. */
  worker?: WorkerHandler
  /** Stable identity for resume and dedupe. Defaults to `JSON.stringify(item)`. */
  key?: (item: T, index: number) => string
  /** Maximum in-flight items. Defaults to 4. */
  concurrency?: number
  /** Extra attempts after the first failure. Defaults to 0. */
  retries?: number
  /** Per-attempt timeout; a worker thread is terminated when it fires. */
  timeoutMs?: number
  /** Stop dispatching new items after the first failure in this stage. */
  failFast?: boolean
}

export interface RunPipelineOptions<T = unknown> {
  /** Names the persisted snapshot; `[A-Za-z0-9._-]` only. */
  runId: string
  stages: readonly StageDefinition<T>[]
  /** Persistence; omit for a pure in-memory run. */
  store?: PipelineStore
  /** Load the previous snapshot and skip completed stages and items. */
  resume?: boolean
  /** External cancellation; pending items stop and workers are terminated. */
  signal?: AbortSignal
  /** Minimum gap between throttled snapshot saves. Defaults to 1000. */
  persistIntervalMs?: number
  /** Progress callback; receives every declared transition. */
  onEvent?: (event: PipelineEvent) => void
}

export type PipelineEvent
  = | { kind: 'stage', stage: string, from: StageStatus, to: StageStatus }
    | { kind: 'item', stage: string, key: string, from: ItemStatus, to: ItemStatus, attempt: number }

export interface StageCounters {
  succeeded: number
  failed: number
  skipped: number
  cancelled: number
  /** Not dispatched: the run was cancelled or `failFast` stopped the stage. */
  pending: number
}

export type FinalStageStatus = Exclude<StageStatus, 'idle' | 'running'>

export interface StageResult extends StageCounters {
  name: string
  status: FinalStageStatus
  durationMs: number
}

export interface ItemFailure {
  stage: string
  key: string
  error: PipelineFailure
}

export interface PipelineResult {
  runId: string
  status: Exclude<PipelineStatus, 'running'>
  /** 0 only when every stage succeeded; 1 otherwise. */
  exitCode: number
  durationMs: number
  stages: StageResult[]
  failures: ItemFailure[]
}
