import type { DevkitConfig } from '../index'
import type { LogLike } from '../shared/index'
/**
 * Local object storage orchestration (SILO / MinIO).
 *
 * SILO is a MinIO maintenance fork: it keeps the S3 API, the `silo server`
 * command and the `MINIO_*` environment contract. It runs as an independent
 * background process and keeps running after the dev server exits. On startup
 * the bucket is created and made anonymously readable so browsers can fetch
 * media directly.
 *
 * A missing binary does not block development: the call returns
 * `started: false` with a reason, and the caller decides whether to warn or fail.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AwsClient } from 'aws4fetch'
import { createLogger } from '../cli/logger'
import { commandOutput, readLogTail, resolveLogPath, sleep } from '../local/util'
import { isLocalMode, isLocalUrl, localBucket, localEndpoint } from '../shared/index'

export const DEFAULT_LOCAL_ACCESS_KEY = 'silo-admin'
export const DEFAULT_LOCAL_SECRET_KEY = 'silo-admin'

export interface SiloCredentials {
  accessKeyId: string
  secretAccessKey: string
}

/** Locate the SILO binary: `SILO_BIN` → `PATH` → Scoop → MinIO fallback. */
export function resolveSiloBinary(): string | undefined {
  const fromWhere = (name: string): string | undefined => (process.platform === 'win32'
    ? commandOutput('where', [name])?.split(/\r?\n/)[0]?.trim()
    : commandOutput('which', [name]))

  const candidates = [
    process.env.SILO_BIN,
    fromWhere('silo'),
    process.env.MINIO_BIN,
    fromWhere('minio'),
    process.platform === 'win32' && process.env.SCOOP && join(process.env.SCOOP, 'apps', 'silo', 'current', 'silo.exe'),
    process.platform === 'win32' && join(process.env.USERPROFILE ?? '', 'scoop', 'apps', 'silo', 'current', 'silo.exe'),
    process.platform === 'win32' && join('C:\\', 'Scoop', 'apps', 'silo', 'current', 'silo.exe'),
    process.platform !== 'win32' && '/usr/local/bin/silo',
    process.platform !== 'win32' && '/opt/homebrew/bin/silo',
  ]

  return candidates.find(path => Boolean(path) && existsSync(path as string)) as string | undefined
}

/** Local development credentials: environment values first, then the SILO defaults. */
export function readLocalCredentials(
  env: Record<string, string | undefined> = process.env,
): SiloCredentials {
  return {
    accessKeyId: env.S3_ACCESS_KEY_ID ?? env.MINIO_ROOT_USER ?? DEFAULT_LOCAL_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? env.MINIO_ROOT_PASSWORD ?? DEFAULT_LOCAL_SECRET_KEY,
  }
}

function signedFetch(credentials: SiloCredentials, url: string, init: RequestInit): Promise<Response> {
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: 's3',
    region: process.env.S3_REGION ?? 'us-east-1',
  })
  return client.fetch(url, init)
}

export interface EnsureLocalBucketOptions {
  credentials: SiloCredentials
  endpoint: string
  bucket: string
  log?: LogLike
}

/** Create the bucket and set an anonymous read policy; idempotent. */
export async function ensureLocalBucket(options: EnsureLocalBucketOptions): Promise<void> {
  const log = options.log ?? createLogger({ name: 'dev.storage' })
  const base = `${options.endpoint.replace(/\/+$/, '')}/${options.bucket}`

  const created = await signedFetch(options.credentials, base, { method: 'PUT' })
  if (!created.ok && created.status !== 409) {
    log.warn(`failed to create local bucket (HTTP ${created.status}): ${await created.text().catch(() => '')}`)
    return
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: ['*'],
        },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${options.bucket}/*`],
      },
    ],
  }
  const applied = await signedFetch(options.credentials, `${base}?policy`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  })
  if (!applied.ok) {
    log.warn(`failed to set anonymous read on the local bucket (HTTP ${applied.status}); browser media requests will be 403`)
  }
}

export interface SiloResult {
  started: boolean
  endpoint: string
  /** Why it did not start (binary missing / health check failed). */
  reason?: string
}

export interface EnsureSiloOptions {
  config: DevkitConfig
  credentials?: SiloCredentials
  dataDir?: string
  endpoint?: string
  log?: LogLike
  dryRun?: boolean
  /** Health-check polling interval in milliseconds; tests override it. */
  pollIntervalMs?: number
  attempts?: number
}

async function healthy(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  }
  catch {
    return false
  }
}

/** Start SILO unless healthy, then ensure the bucket exists. */
export async function ensureSiloRunning(options: EnsureSiloOptions): Promise<SiloResult> {
  const { config } = options
  const log = options.log ?? createLogger({ name: 'dev.storage' })

  if (!isLocalMode(process.env, config.env.localFlag)) {
    return {
      started: false,
      endpoint: localEndpoint(process.env),
      reason: `${config.env.localFlag} is off`,
    }
  }

  const endpoint = (options.endpoint ?? localEndpoint(process.env)).replace(/\/+$/, '')
  if (!isLocalUrl(endpoint))
    throw new Error(`the object storage endpoint must be local when the local flag is on: ${endpoint}`)

  const bucket = localBucket(process.env, config.storage.bucket)
  const credentials = options.credentials ?? readLocalCredentials()

  if (options.dryRun) {
    log.info(`dry-run: would start local object storage at ${endpoint} and ensure bucket ${bucket}`)
    return { started: false, endpoint, reason: 'dry-run' }
  }

  if (await healthy(endpoint)) {
    log.info(`SILO is already running (${endpoint})`)
    await ensureLocalBucket({ credentials, endpoint, bucket, log })
    return { started: true, endpoint }
  }

  const binary = resolveSiloBinary()
  if (!binary) {
    return {
      started: false,
      endpoint,
      reason: 'silo executable not found (add it to PATH or set SILO_BIN)',
    }
  }

  const dataDir = resolve(options.dataDir ?? process.env.SILO_DATA ?? config.storage.dataDir)
  mkdirSync(dataDir, { recursive: true })

  const parsed = new URL(endpoint)
  const port = parsed.port || '9000'
  const consolePort = process.env.SILO_CONSOLE_PORT ?? String(Number(port) + 1)
  const logFile = resolveLogPath(config.paths.logs, 'silo.log')
  const fd = openSync(logFile, 'a')
  const env = {
    ...process.env,
    MINIO_ROOT_USER: credentials.accessKeyId,
    MINIO_ROOT_PASSWORD: credentials.secretAccessKey,
    MINIO_API_CORS_ALLOW_ORIGIN: process.env.MINIO_API_CORS_ALLOW_ORIGIN ?? '*',
  }
  const args = [
    'server',
    dataDir,
    '--address',
    `${parsed.hostname}:${port}`,
    '--console-address',
    `127.0.0.1:${consolePort}`,
  ]

  log.info(`starting SILO (${dataDir}) ...`)
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', [
        '/c',
        'start',
        '',
        '/b',
        binary,
        ...args,
      ], {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        env,
      })
    : spawn(binary, args, {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', fd, fd],
        env,
      })
  child.unref()

  const attempts = options.attempts ?? 50
  const interval = options.pollIntervalMs ?? 200
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(interval)
    if (await healthy(endpoint)) {
      log.info(`SILO ready: ${endpoint} (data ${dataDir})`)
      await ensureLocalBucket({ credentials, endpoint, bucket, log })
      return { started: true, endpoint }
    }
  }

  const tail = readLogTail(logFile)
  throw new Error(`SILO failed to start (${endpoint})${tail
    ? `:\n${tail}`
    : `, see ${logFile}`}`)
}
