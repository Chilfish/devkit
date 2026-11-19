import type { LogLike } from '../shared/index'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}
const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

export interface LoggerOptions {
  /** Log prefix, usually the command id. */
  name: string
  /** Lines below this level are dropped. Defaults to info. */
  level?: LogLevel
  /** Summary only: suppress info/debug, keep warn/error. */
  quiet?: boolean
  /** Append NDJSON lines (object per line with time and level). */
  file?: string
  /** Drop `output()`. The runtime owns stdout in `--json` mode. */
  silentOutput?: boolean
  /** Injected writer, for tests. */
  write?: (stream: 'out' | 'err', line: string) => void
}

export interface Logger extends LogLike {
  readonly name: string
  /** Child prefix, e.g. `db.ingest` → `db.ingest/nonoka`. */
  child: (suffix: string) => Logger
  /** Command data output to stdout; the runtime owns stdout in `--json` mode. */
  output: (message: string) => void
}

function defaultWrite(stream: 'out' | 'err', line: string): void {
  if (stream === 'err')
    process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

/**
 * Create a command logger.
 *
 * Human-readable logs always go to stderr; stdout is reserved for command data
 * (ids, JSON envelopes), so `value=$(cmd 2>/dev/null)` stays clean.
 */
export function createLogger(options: LoggerOptions): Logger {
  const { name } = options
  const threshold = LEVEL_RANK[options.level ?? 'info']
  const write = options.write ?? defaultWrite
  const file = options.file
  let fileReady = false

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (options.quiet && LEVEL_RANK[level] < LEVEL_RANK.warn)
      return
    if (LEVEL_RANK[level] < threshold)
      return

    const prefix = level === 'info'
      ? `[${name}]`
      : `[${name}] ${LEVEL_LABEL[level]}`
    const suffix = fields && Object.keys(fields).length > 0
      ? ` ${JSON.stringify(fields)}`
      : ''
    write('err', `${prefix} ${message}${suffix}`)

    if (file) {
      try {
        if (!fileReady) {
          mkdirSync(dirname(file), { recursive: true })
          fileReady = true
        }
        appendFileSync(
          file,
          `${JSON.stringify({
            time: new Date().toISOString(),
            level,
            name,
            message,
            ...fields,
          })}\n`,
          'utf8',
        )
      }
      catch {
        // Log write failures must not change the command result.
      }
    }
  }

  return {
    name,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    line: (message) => {
      if (options.quiet)
        return
      if (threshold > LEVEL_RANK.info)
        return
      write('err', message)
    },
    output: (message) => {
      if (options.silentOutput)
        return
      write('out', message)
    },
    child: suffix => createLogger({ ...options, name: `${name}/${suffix}` }),
  }
}
