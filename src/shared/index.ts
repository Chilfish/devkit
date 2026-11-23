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

const ENV_LINE = /^\s*([\w.-]+)\s*=/
const INLINE_COMMENT = /\s+#/

/** Strip a matching quote pair and an unquoted trailing `# comment`. */
function parseEnvValue(raw: string): string {
  const value = raw.trim()
  const quote = value[0]
  if ((quote === '"' || quote === '\'') && value.length > 1) {
    const end = value.indexOf(quote, 1)
    if (end !== -1)
      return value.slice(1, end)
  }
  const comment = INLINE_COMMENT.exec(value)
  return (comment
    ? value.slice(0, comment.index)
    : value).trim()
}

/**
 * Parse `.dev.vars` / `.env` style content.
 *
 * No variable expansion; `KEY=a=b` splits on the first `=`. Matching quotes are
 * removed together with an unquoted trailing comment. Keys may contain `.` and `-`.
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
    values[key] = parseEnvValue(trimmed.slice(separator + 1))
  }
  return values
}

/**
 * Overwrite existing keys, keep all other lines (comments, blank lines,
 * unrelated keys) and append missing ones.
 *
 * Used to point an env file at local services without destroying other settings.
 * The original line ending (LF or CRLF) is preserved.
 */
export function upsertEnvValues(content: string, values: Record<string, string>): string {
  const eol = content.includes('\r\n')
    ? '\r\n'
    : '\n'
  const pending = new Map(Object.entries(values))
  const lines = content.length > 0
    ? content.split(/\r?\n/)
    : []
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const result = lines.map((line) => {
    const match = ENV_LINE.exec(line)
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
  return `${result.join(eol).replace(/(?:\r?\n)+$/, '')}${eol}`
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
