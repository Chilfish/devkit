import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_ACCESS_KEY,
  DEFAULT_LOCAL_SECRET_KEY,
  ensureSiloRunning,
  readLocalCredentials,
  resolveSiloBinary,
} from '../../src/storage/index'
import { createConfig } from '../testkit/config'

const config = createConfig()
let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const key of [
    'LOCAL',
    'S3_ENDPOINT',
    'MINIO_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
  ])
    delete process.env[key]
})

afterEach(() => {
  process.env = savedEnv
})

describe('readLocalCredentials', () => {
  it('falls back to the SILO defaults', () => {
    expect(readLocalCredentials({})).toEqual({
      accessKeyId: DEFAULT_LOCAL_ACCESS_KEY,
      secretAccessKey: DEFAULT_LOCAL_SECRET_KEY,
    })
  })

  it('prefers S3 credentials, then MinIO variables', () => {
    expect(readLocalCredentials({ S3_ACCESS_KEY_ID: 's3', S3_SECRET_ACCESS_KEY: 's3-secret' })).toEqual({
      accessKeyId: 's3',
      secretAccessKey: 's3-secret',
    })
    expect(readLocalCredentials({ MINIO_ROOT_USER: 'minio', MINIO_ROOT_PASSWORD: 'minio-secret' })).toEqual({
      accessKeyId: 'minio',
      secretAccessKey: 'minio-secret',
    })
  })
})

describe('resolveSiloBinary', () => {
  it('returns a string or undefined', () => {
    process.env.SILO_BIN = 'C:\\does-not-exist\\silo.exe'
    const binary = resolveSiloBinary()
    expect(binary === undefined || typeof binary === 'string').toBe(true)
  })
})

describe('ensureSiloRunning', () => {
  it('does nothing when the local flag is off', async () => {
    const result = await ensureSiloRunning({ config })
    expect(result.started).toBe(false)
    expect(result.reason).toContain('LOCAL')
  })

  it('reports the plan without starting in dry-run mode', async () => {
    process.env.LOCAL = '1'
    const result = await ensureSiloRunning({ config, dryRun: true })
    expect(result.started).toBe(false)
    expect(result.reason).toBe('dry-run')
  })

  it('rejects a non-local endpoint in local mode', async () => {
    process.env.LOCAL = '1'
    process.env.S3_ENDPOINT = 'https://s3.example.com'
    await expect(ensureSiloRunning({ config, dryRun: true })).rejects.toThrow(/must be local/)
  })
})
