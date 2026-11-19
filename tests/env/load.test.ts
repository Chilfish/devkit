import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeEnvironment, loadEnvFile, readEnvFile } from '../../src/env/index'
import { createConfig } from '../testkit/config'

const config = createConfig()

function snapshotEnv(): () => void {
  const saved = { ...process.env }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved))
        delete process.env[key]
    }
    Object.assign(process.env, saved)
  }
}

function writeEnv(dir: string, content: string): void {
  writeFileSync(join(dir, config.env.file), content)
}

let restoreEnv: () => void
let dir: string

beforeEach(() => {
  restoreEnv = snapshotEnv()
  for (const key of [
    'LOCAL',
    'DATABASE_URL',
    'DATABASE_URL_ONLINE',
    'NEON_HTTP_ENDPOINT',
    'NEON_HTTP_ENDPOINT_ONLINE',
    'PUBLIC_BASE',
    'R2_BUCKET',
    'S3_ENDPOINT',
  ])
    delete process.env[key]
  dir = mkdtempSync(join(tmpdir(), 'devkit-env-'))
})

afterEach(() => {
  restoreEnv()
  rmSync(dir, { recursive: true, force: true })
})

describe('loadEnvFile', () => {
  it('fills keys missing from the process environment only', () => {
    writeEnv(dir, 'A=file\nB=file\n')
    process.env.B = 'process'

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.A).toBe('file')
    expect(process.env.B).toBe('process')
  })

  it('resolves the local flag as process environment > file', () => {
    writeEnv(dir, [
      'LOCAL=1',
      'DATABASE_URL=postgres://postgres@localhost:5432/file_db',
      'DATABASE_URL_ONLINE=postgres://user@db.example.com:5432/remote',
    ].join('\n'))

    loadEnvFile({ config, cwd: dir, log: false })
    expect(process.env.LOCAL).toBe('1')
    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/file_db')

    // A process-level flag wins over the file, so the remote target is expanded.
    delete process.env.DATABASE_URL
    process.env.LOCAL = '0'
    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.LOCAL).toBe('0')
    expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/remote')
  })

  describe('local mode', () => {
    beforeEach(() => {
      process.env.LOCAL = '1'
    })

    it('ignores remote targets and forces local addresses', () => {
      writeEnv(dir, [
        'DATABASE_URL_ONLINE=postgres://user@db.example.com:5432/remote',
        'NEON_HTTP_ENDPOINT_ONLINE=https://proxy.example.com/sql',
        'PUBLIC_BASE=https://cdn.example.com',
      ].join('\n'))

      loadEnvFile({ config, cwd: dir, log: false })

      expect(process.env.DATABASE_URL).toBe(config.database.localUrl)
      expect(process.env.NEON_HTTP_ENDPOINT).toBe(config.database.proxyEndpoint)
      expect(process.env.PUBLIC_BASE).toBe('http://127.0.0.1:9000/devkit-data')
      expect(process.env.LOCAL).toBe('1')
    })

    it('keeps an explicit local database but overrides a remote one', () => {
      process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:5433/custom'
      loadEnvFile({ config, cwd: dir, log: false })
      expect(process.env.DATABASE_URL).toBe('postgres://postgres@127.0.0.1:5433/custom')

      process.env.DATABASE_URL = 'postgres://user@db.example.com/app'
      loadEnvFile({ config, cwd: dir, log: false })
      expect(process.env.DATABASE_URL).toBe(config.database.localUrl)
    })
  })

  describe('remote mode', () => {
    beforeEach(() => {
      process.env.LOCAL = '0'
    })

    it('expands *_ONLINE into base keys', () => {
      writeEnv(dir, [
        'DATABASE_URL=postgres://postgres@localhost:5432/local',
        'DATABASE_URL_ONLINE=postgres://user@db.example.com:5432/remote',
      ].join('\n'))

      loadEnvFile({ config, cwd: dir, log: false })

      expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/remote')
    })

    it('keeps explicitly set base keys', () => {
      process.env.DATABASE_URL = 'postgres://user@db.example.com:5432/explicit'
      writeEnv(dir, 'DATABASE_URL_ONLINE=postgres://user@db.example.com:5432/remote\n')

      loadEnvFile({ config, cwd: dir, log: false })

      expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/explicit')
    })

    it('clears a local database when no remote target exists', () => {
      writeEnv(dir, 'DATABASE_URL=postgres://postgres@localhost:5432/local\n')

      loadEnvFile({ config, cwd: dir, log: false })

      expect(process.env.DATABASE_URL).toBeUndefined()
    })

    it('does not expand when the suffix is empty', () => {
      const noSuffix = createConfig({
        env: { file: '.dev.vars', onlineSuffix: '' },
      })
      process.env.DATABASE_URL_ONLINE = 'postgres://user@db.example.com:5432/remote'

      loadEnvFile({ config: noSuffix, cwd: dir, log: false })

      expect(process.env.DATABASE_URL).toBeUndefined()
    })
  })

  it('does nothing when the file is missing', () => {
    loadEnvFile({ config, cwd: dir, log: false })
    expect(process.env.DATABASE_URL).toBeUndefined()
  })
})

describe('readEnvFile', () => {
  it('parses without touching process.env', () => {
    writeFileSync(join(dir, '.dev.vars'), 'A=1\n')
    expect(readEnvFile(join(dir, '.dev.vars'))).toEqual({ A: '1' })
    expect(process.env.A).toBeUndefined()
  })
})

describe('describeEnvironment', () => {
  it('describes local mode with host, database and storage', () => {
    const text = describeEnvironment({
      LOCAL: '1',
      DATABASE_URL: 'postgres://user:secret@localhost:5432/app',
      R2_BUCKET: 'bucket',
    }, config)

    expect(text).toContain('local mode (LOCAL=1)')
    expect(text).toContain('database localhost:5432/app')
    expect(text).toContain('local storage http://127.0.0.1:9000/bucket')
  })

  it('describes remote mode without storage when unset', () => {
    const text = describeEnvironment({ LOCAL: '0', DATABASE_URL: 'postgres://user@db.example.com/app' }, config)
    expect(text).toBe('remote mode · database db.example.com/app')
  })

  it('never prints credentials', () => {
    const text = describeEnvironment({ LOCAL: '1', DATABASE_URL: 'postgres://user:secret@localhost:5432/app' }, config)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('user')
  })
})
