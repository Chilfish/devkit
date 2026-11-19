/**
 * Pure-function layer: zero dependencies, no `node:*` / `bun:*` imports, so
 * Workers and browsers can import it directly.
 *
 * Only URL checks, env text parsing and local address derivation belong here.
 */

/** Structural log interface: matches the `./cli` Logger without importing it. */
export interface LogLike {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
  line: (message: string) => void
}

export type EnvRecord = Record<string, string | undefined>

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
])

/** Strict local URL check: only `localhost` / `127.0.0.1` / `[::1]`, no fuzzy matching. */
export function isLocalUrl(value: string | undefined | null): boolean {
  if (!value)
    return false
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return false
  }
  return LOCAL_HOSTS.has(url.hostname.toLowerCase())
}

/** Local master switch: `1` / `true` / `yes`, case-insensitive and trimmed. */
export function isLocalMode(env: EnvRecord, localFlag = 'LOCAL'): boolean {
  const value = (env[localFlag] ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * Parse `.dev.vars` / `.env` style content.
 *
 * No variable expansion; `KEY=a=b` splits on the first `=`. Matching quotes are removed.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const separator = trimmed.indexOf('=')
    if (separator === -1)
      continue
    const key = trimmed.slice(0, separator).trim()
    if (!key)
      continue
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/**
 * Overwrite existing keys, keep all other lines (comments, blank lines,
 * `*_ONLINE`) and append missing ones.
 *
 * Used to point an env file at local services without destroying other settings.
 */
export function upsertEnvValues(content: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values))
  const lines = content.length > 0
    ? content.split(/\r?\n/)
    : []
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const result = lines.map((line) => {
    const match = /^\s*(\w+)\s*=/.exec(line)
    if (!match)
      return line
    const key = match[1] as string
    if (!pending.has(key))
      return line
    const value = pending.get(key) as string
    pending.delete(key)
    return `${key}=${value}`
  })
  for (const [key, value] of pending) result.push(`${key}=${value}`)
  return `${result.join('\n').replace(/\n+$/, '')}\n`
}

/** Anonymous read base for the local bucket: path-style, `<endpoint>/<bucket>`. */
export function localPublicBase(endpoint: string, bucket: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${bucket}`
}

/** Local S3-compatible endpoint. Defaults to `http://127.0.0.1:9000`. */
export function localEndpoint(env: EnvRecord): string {
  return (env.S3_ENDPOINT ?? env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000').replace(/\/+$/, '')
}

/** Local bucket: explicit config > `R2_BUCKET` > fallback. */
export function localBucket(env: EnvRecord, fallback = 'devkit-local'): string {
  return env.R2_BUCKET ?? fallback
}

/** Parse host and database name out of a database URL; null when unparseable. */
export function parseDatabaseInfo(value: string | undefined | null): { host: string, database: string } | null {
  if (!value)
    return null
  try {
    const url = new URL(value)
    return {
      host: `${url.hostname}${url.port
        ? `:${url.port}`
        : ''}`,
      database: url.pathname.replace(/^\//, ''),
    }
  }
  catch {
    return null
  }
}
