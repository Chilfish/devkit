/**
 * Pipeline error types.
 *
 * Every failure surfaces with a stable `code` so hosts can branch on it and
 * print a copy-pasteable next step, matching the CLI error contract.
 */

export interface PipelineErrorOptions {
  /** Stable short code, e.g. `TIMEOUT`. */
  code?: string
  /** Machine-readable context, e.g. the stage and key. */
  context?: Record<string, unknown>
  cause?: unknown
}

/** Base class for every pipeline failure. */
export class PipelineError extends Error {
  readonly code: string
  readonly context?: Record<string, unknown>

  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, options.cause === undefined
      ? undefined
      : { cause: options.cause })
    this.name = 'PipelineError'
    this.code = options.code ?? 'PIPELINE_ERROR'
    this.context = options.context
  }
}

/** Invalid stage definition or run options; thrown before any work starts. */
export class PipelineConfigError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'INVALID_PIPELINE', ...options })
    this.name = 'PipelineConfigError'
  }
}

/** An illegal stage or item transition; the state machine rejected it. */
export class PipelineStateError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'INVALID_TRANSITION', ...options })
    this.name = 'PipelineStateError'
  }
}

/** The run was cancelled through its `AbortSignal` or the worker pool closed. */
export class PipelineCancelledError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'CANCELLED', ...options })
    this.name = 'PipelineCancelledError'
  }
}

/** A single attempt exceeded `timeoutMs`; the worker thread is terminated. */
export class PipelineTimeoutError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'TIMEOUT', ...options })
    this.name = 'PipelineTimeoutError'
  }
}

/** Loading or writing a snapshot failed, or the snapshot is corrupt. */
export class PipelineStoreError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'STORE', ...options })
    this.name = 'PipelineStoreError'
  }
}

/** A worker thread crashed, exited early or failed to load the handler module. */
export class PipelineWorkerError extends PipelineError {
  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, { code: 'WORKER', ...options })
    this.name = 'PipelineWorkerError'
  }
}
