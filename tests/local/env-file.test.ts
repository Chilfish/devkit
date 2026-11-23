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
  it('creates the base file with the local values', () => {
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

  it('writes <file>.dev when it exists', () => {
    process.env.LOCAL = '1'
    writeFileSync(join(dir, '.dev.vars'), 'DATABASE_URL=postgres://user@db.example.com/base\n')
    writeFileSync(join(dir, '.dev.vars.dev'), '# local overrides\nOTHER=value\n')

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    const base = readFileSync(join(dir, '.dev.vars'), 'utf8')
    expect(base).toBe('DATABASE_URL=postgres://user@db.example.com/base\n')

    const dev = readFileSync(join(dir, '.dev.vars.dev'), 'utf8')
    expect(dev).toContain('# local overrides')
    expect(dev).toContain('OTHER=value')
    expect(dev).toContain('DATABASE_URL=postgres://postgres@localhost:5432/devkit_dev')
    expect(dev).toContain('LOCAL=1')
  })

  it('overwrites declared keys while preserving other lines', () => {
    process.env.LOCAL = '1'
    writeFileSync(join(dir, '.dev.vars'), [
      '# keep this comment',
      'DATABASE_URL=postgres://user@db.example.com/app',
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
    expect(content).toContain('OTHER=value')
  })

  it('does not write anything in remote mode', () => {
    writeFileSync(join(dir, '.dev.vars'), 'OTHER=value\n')
    writeFileSync(join(dir, '.dev.vars.prod'), 'DATABASE_URL=postgres://user@db.example.com/prod\n')

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toBe('OTHER=value\n')
    expect(readFileSync(join(dir, '.dev.vars.prod'), 'utf8'))
      .toBe('DATABASE_URL=postgres://user@db.example.com/prod\n')
  })

  it('does not create a prod file in remote mode', () => {
    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    expect(existsSync(join(dir, '.dev.vars.prod'))).toBe(false)
    expect(existsSync(join(dir, '.dev.vars'))).toBe(false)
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

  it('leaves an already converged file unchanged', () => {
    process.env.LOCAL = '1'

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })
    const first = readFileSync(join(dir, '.dev.vars'), 'utf8')

    ensureEnvFile({
      config,
      databaseUrl,
      endpoint,
      cwd: dir,
    })
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toBe(first)
  })

  it('skips the public base when storage.publicBaseEnv is not configured', () => {
    process.env.LOCAL = '1'
    const bare = createConfig({ storage: {} })

    ensureEnvFile({
      config: bare,
      databaseUrl,
      endpoint,
      cwd: dir,
    })

    const content = readFileSync(join(dir, '.dev.vars'), 'utf8')
    expect(content).toContain('DATABASE_URL=postgres://postgres@localhost:5432/devkit_dev')
    expect(content).not.toContain('PUBLIC_BASE')
  })
})
