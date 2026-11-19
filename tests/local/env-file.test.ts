import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureEnvFile } from '../../src/local/index'
import { createConfig } from '../testkit/config'

const config = createConfig()
let dir: string
let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  delete process.env.LOCAL
  dir = mkdtempSync(join(tmpdir(), 'devkit-envfile-'))
})

afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

const databaseUrl = 'postgres://postgres@localhost:5432/devkit_dev'
const endpoint = 'http://127.0.0.1:4444/sql'

describe('ensureEnvFile', () => {
  it('creates the file with the local values', () => {
    process.env.LOCAL = '1'

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    const content = readFileSync(join(dir, '.dev.vars'), 'utf8')
    expect(content).toContain('DATABASE_URL=postgres://postgres@localhost:5432/devkit_dev')
    expect(content).toContain('NEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql')
    expect(content).toContain('LOCAL=1')
    expect(content).toContain('PUBLIC_BASE=http://127.0.0.1:9000/devkit-data')
  })

  it('overwrites declared keys in local mode while preserving other lines', () => {
    process.env.LOCAL = '1'
    writeFileSync(join(dir, '.dev.vars'), [
      '# keep this comment',
      'DATABASE_URL=postgres://user@db.example.com/app',
      'DATABASE_URL_ONLINE=postgres://user@db.example.com/app_online',
      'OTHER=value',
      '',
    ].join('\n'))

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    const content = readFileSync(join(dir, '.dev.vars'), 'utf8')
    expect(content).toContain('# keep this comment')
    expect(content).toContain('DATABASE_URL=postgres://postgres@localhost:5432/devkit_dev')
    expect(content).toContain('DATABASE_URL_ONLINE=postgres://user@db.example.com/app_online')
    expect(content).toContain('OTHER=value')
  })

  it('only appends missing keys in remote mode', () => {
    writeFileSync(join(dir, '.dev.vars'), 'DATABASE_URL=postgres://user@db.example.com/app\n')

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    const content = readFileSync(join(dir, '.dev.vars'), 'utf8')
    expect(content).toContain('DATABASE_URL=postgres://user@db.example.com/app')
    expect(content).toContain('NEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql')
    expect(content).not.toContain('LOCAL=')
  })

  it('does not touch the file in dry-run mode', () => {
    process.env.LOCAL = '1'

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
      dryRun: true,
    })

    expect(existsSync(join(dir, '.dev.vars'))).toBe(false)
  })
})
