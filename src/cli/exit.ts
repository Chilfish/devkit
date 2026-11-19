/**
 * Unified process exit codes. Commands never call `process.exit` themselves;
 * the runtime maps return values and thrown errors.
 *
 * 0  success / already converged
 * 1  runtime failure (partial batch failure included)
 * 2  usage error: unknown flag, missing required value, invalid value
 * 3  missing configuration: env var / credentials / config file
 */
export const EXIT_CODES = {
  ok: 0,
  failure: 1,
  usage: 2,
  config: 3,
} as const

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES]

export interface CliErrorOptions {
  /** Stable short code, written to envelope `error.code` (e.g. MISSING_ENV). */
  code?: string
  /** Copy-pasteable next step for humans and agents. */
  hint?: string
  /** Machine-readable context, written to envelope `error.context`. */
  context?: Record<string, unknown>
  exitCode?: ExitCode
  cause?: unknown
}

/** Throw this inside commands; the runtime converts it to an envelope and exit code. */
export class CliError extends Error {
  readonly code: string
  readonly hint?: string
  readonly context?: Record<string, unknown>
  readonly exitCode: ExitCode

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined
      ? undefined
      : { cause: options.cause })
    this.name = 'CliError'
    this.code = options.code ?? 'FAILED'
    this.hint = options.hint
    this.context = options.context
    this.exitCode = options.exitCode ?? EXIT_CODES.failure
  }
}

/** Argument usage error, exit code 2. */
export class UsageError extends CliError {
  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, { code: 'INVALID_ARGUMENT', exitCode: EXIT_CODES.usage, ...options })
    this.name = 'UsageError'
  }
}

/** Missing env var / credentials / config, exit code 3. */
export class ConfigError extends CliError {
  constructor(message: string, options: CliErrorOptions = {}) {
    super(message, { code: 'MISSING_CONFIG', exitCode: EXIT_CODES.config, ...options })
    this.name = 'ConfigError'
  }
}

/** Read a required env var; throws ConfigError with a copy-pasteable next step. */
export function requireEnvVar(name: string, hint?: string): string {
  const value = process.env[name]
  if (!value) {
    throw new ConfigError(`Missing environment variable ${name}`, {
      code: 'MISSING_ENV',
      hint: hint ?? `Set ${name} in the environment file`,
      context: { name },
    })
  }
  return value
}
