/** Result of one command. The runtime turns it into a JSON envelope and exit code. */
export interface CommandResult<T = unknown> {
  /** Placed in the envelope `data` field; ignored in human mode. */
  data?: T
  /** Exit code when non-zero; defaults to 0. */
  exitCode?: number
  /** Closing summary line in human mode. */
  summary?: string
}

export interface EnvelopeError {
  code: string
  message: string
  hint?: string
  context?: Record<string, unknown>
}

export interface EnvelopeMeta {
  mode: 'local' | 'remote'
  durationMs: number
  dryRun: boolean
  version: string
}

export interface Envelope<T = unknown> {
  ok: boolean
  command: string
  data: T | null
  error: EnvelopeError | null
  meta: EnvelopeMeta
}

export function buildEnvelope<T>(input: {
  command: string
  ok: boolean
  data?: T
  error?: EnvelopeError | null
  meta: EnvelopeMeta
}): Envelope<T> {
  return {
    ok: input.ok,
    command: input.command,
    data: input.ok
      ? (input.data ?? null)
      : null,
    error: input.ok
      ? null
      : (input.error ?? { code: 'FAILED', message: 'Unknown error' }),
    meta: input.meta,
  }
}

/** Single-line JSON: agents need one line so `| jq` works. */
export function serializeEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope)
}
