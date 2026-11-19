import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliError } from '../../src/cli/index'
import { applyOnlineEnv, readOnlineTarget } from '../../src/env/index'
import { createConfig } from '../testkit/config'

const config = createConfig()
let dir: string
let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const key of [
    'LOCAL',
    'DATABASE_URL',
    'DATABASE_URL_ONLINE',
    'NEON_HTTP_ENDPOINT',
    'S3_ENDPOINT',
    'MINIO_ENDPOINT',
    'SILO_BIN',
    'SILO_DATA',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'R2_BUCKET',
    'R2_BUCKET_ONLINE',
  ])
    delete process.env[key]
  dir = mkdtempSync(join(tmpdir(), 'devkit-online-'))
})

afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

function writeEnv(content: string): void {
  writeFileSync(join(dir, config.env.file), content)
}

describe('readOnlineTarget', () => {
  it('fails with exit code 1 when the env file is missing', () => {
    try {
      readOnlineTarget({ config, cwd: dir })
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as CliError).exitCode).toBe(1)
    }
  })

  it('requires the remote database key', () => {
    writeEnv('DATABASE_URL=postgres://postgres@localhost:5432/local\n')
    expect(() => readOnlineTarget({ config, cwd: dir })).toThrow(/DATABASE_URL_ONLINE/)
  })

  it('refuses a local remote target', () => {
    writeEnv('DATABASE_URL_ONLINE=postgres://postgres@localhost:5432/local\n')
    expect(() => readOnlineTarget({ config, cwd: dir })).toThrow(/localhost/)
  })

  it('returns the remote database and bucket', () => {
    writeEnv([
      'DATABASE_URL=postgres://postgres@localhost:5432/local',
      'DATABASE_URL_ONLINE=postgres://user@db.example.com:5432/remote',
      'R2_BUCKET=plain-bucket',
      'R2_BUCKET_ONLINE=remote-bucket',
    ].join('\n'))

    expect(readOnlineTarget({ config, cwd: dir })).toMatchObject({
      databaseUrl: 'postgres://user@db.example.com:5432/remote',
      bucket: 'remote-bucket',
    })
  })
})

describe('applyOnlineEnv', () => {
  it('expands remote keys, clears local endpoints, and restores state', () => {
    process.env.LOCAL = '1'
    process.env.DATABASE_URL = 'postgres://postgres@localhost:5432/local'
    process.env.NEON_HTTP_ENDPOINT = 'http://127.0.0.1:4444/sql'
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9000'
    process.env.R2_BUCKET = 'plain-bucket'

    const restore = applyOnlineEnv({
      config,
      remote: {
        DATABASE_URL: 'postgres://postgres@localhost:5432/local',
        DATABASE_URL_ONLINE: 'postgres://user@db.example.com:5432/remote',
        R2_BUCKET: 'plain-bucket',
        R2_BUCKET_ONLINE: 'remote-bucket',
      },
    })

    expect(process.env.LOCAL).toBe('0')
    expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/remote')
    expect(process.env.R2_BUCKET).toBe('remote-bucket')
    expect(process.env.NEON_HTTP_ENDPOINT).toBeUndefined()
    expect(process.env.S3_ENDPOINT).toBeUndefined()

    restore()

    expect(process.env.LOCAL).toBe('1')
    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/local')
    expect(process.env.NEON_HTTP_ENDPOINT).toBe('http://127.0.0.1:4444/sql')
    expect(process.env.S3_ENDPOINT).toBe('http://127.0.0.1:9000')
    expect(process.env.R2_BUCKET).toBe('plain-bucket')
  })

  it('ignores the local flag from the file', () => {
    const restore = applyOnlineEnv({
      config,
      remote: { LOCAL: '1' },
    })
    expect(process.env.LOCAL).toBe('0')
    restore()
  })
})
