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

function writeEnv(dir: string, content: string, name = config.env.file): void {
  writeFileSync(join(dir, name), content)
}

let restoreEnv: () => void
let dir: string

beforeEach(() => {
  restoreEnv = snapshotEnv()
  for (const key of [
    'LOCAL',
    'DATABASE_URL',
    'NEON_HTTP_ENDPOINT',
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

  it('resolves the local flag as process environment > base file', () => {
    writeEnv(dir, 'LOCAL=1\nDATABASE_URL=postgres://postgres@localhost:5432/file_db\n')
    writeEnv(dir, 'DATABASE_URL=postgres://user@db.example.com:5432/remote\n', '.dev.vars.prod')

    loadEnvFile({ config, cwd: dir, log: false })
    expect(process.env.LOCAL).toBe('1')
    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/file_db')

    // A process-level flag wins over the file, so the prod file applies.
    delete process.env.DATABASE_URL
    process.env.LOCAL = '0'
    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.LOCAL).toBe('0')
    expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/remote')
  })

  it('layers <file>.dev over the base file in local mode', () => {
    process.env.LOCAL = '1'
    writeEnv(dir, 'DATABASE_URL=postgres://user@db.example.com/base\nSHARED=base\n')
    writeEnv(dir, 'SHARED=dev\nEXTRA=dev\n', '.dev.vars.dev')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.SHARED).toBe('dev')
    expect(process.env.EXTRA).toBe('dev')
    expect(process.env.DATABASE_URL).toBe(config.database.localUrl)
  })

  it('layers <file>.prod over the base file in remote mode', () => {
    process.env.LOCAL = '0'
    writeEnv(dir, 'DATABASE_URL=postgres://user@db.example.com/base\nSHARED=base\n')
    writeEnv(dir, 'DATABASE_URL=postgres://user@prod.example.com/prod\nSHARED=prod\n', '.dev.vars.prod')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.DATABASE_URL).toBe('postgres://user@prod.example.com/prod')
    expect(process.env.SHARED).toBe('prod')
  })

  it('ignores the opposite mode file', () => {
    process.env.LOCAL = '0'
    writeEnv(dir, 'EXTRA=dev\n', '.dev.vars.dev')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.EXTRA).toBeUndefined()
  })

  it('lets explicit process variables win over mode files', () => {
    process.env.LOCAL = '0'
    process.env.DATABASE_URL = 'postgres://user@db.example.com:5432/explicit'
    writeEnv(dir, 'DATABASE_URL=postgres://user@prod.example.com/prod\n', '.dev.vars.prod')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com:5432/explicit')
  })

  it('falls back to the base file when the mode file is missing', () => {
    process.env.LOCAL = '0'
    writeEnv(dir, 'DATABASE_URL=postgres://user@db.example.com/base\n')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.DATABASE_URL).toBe('postgres://user@db.example.com/base')
  })

  it('clears a local database in remote mode when no prod file exists', () => {
    process.env.LOCAL = '0'
    writeEnv(dir, 'DATABASE_URL=postgres://postgres@localhost:5432/local\n')

    loadEnvFile({ config, cwd: dir, log: false })

    expect(process.env.DATABASE_URL).toBeUndefined()
  })

  describe('local mode', () => {
    beforeEach(() => {
      process.env.LOCAL = '1'
    })

    it('forces local addresses and derives the public base', () => {
      writeEnv(dir, 'PUBLIC_BASE=https://cdn.example.com\n')

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

  it('describes remote R2 storage when a bucket is set', () => {
    const text = describeEnvironment({ LOCAL: '0', DATABASE_URL: 'postgres://user@db.example.com/app', R2_BUCKET: 'remote' }, config)
    expect(text).toContain('R2 storage remote')
  })

  it('prints the banner to stderr unless logging is disabled', () => {
    const chunks: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      loadEnvFile({ config, cwd: dir })
    }
    finally {
      process.stderr.write = write
    }

    expect(chunks.join('')).toContain('[env]')
  })
})
