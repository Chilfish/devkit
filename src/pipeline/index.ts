/**
 * `@chilfish/devkit/pipeline` — bounded-concurrency stage runner.
 *
 * Node-only entry: it spawns worker threads and writes snapshots through
 * `node:fs`. Hosts wire it into their own `CommandSpec`; the pipeline itself
 * knows nothing about the CLI.
 */
export {
  PipelineCancelledError,
  PipelineConfigError,
  PipelineError,
  PipelineStateError,
  PipelineStoreError,
  PipelineTimeoutError,
  PipelineWorkerError,
} from './errors'
export type { PipelineErrorOptions } from './errors'
export { runPipeline } from './runner'
export { assertItemTransition, assertStageTransition, resumeItemStatus, resumeStageStatus } from './state'
export type { ItemStatus, PipelineStatus, StageStatus, StateKind } from './state'
export { createFilePipelineStore, createMemoryPipelineStore, validateRunId } from './store'
export type { FilePipelineStoreOptions } from './store'
export type {
  FinalStageStatus,
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
  WorkerHandler,
  WorkerItemContext,
} from './types'
export { resolveWorkerEntry, WorkerPool } from './worker-pool'
export type { WorkerPoolOptions } from './worker-pool'
