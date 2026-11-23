import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * End-to-end CLI contract against the example wiring:
 * help/output/exit codes and the JSON envelope.
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const cli = join(root, 'examples', 'cli.ts')

/**
 * Run from an empty directory, not the repository root: `loadEnvFile` resolves
 * the env file from `cwd`, so a developer's local `.env` must not decide the
 * exit codes these tests assert.
 */
const cwd = mkdtempSync(join(tmpdir(), 'devkit-e2e-'))

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function hasBun(): boolean {
  try {
    execFileSync('bun', ['--version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

const bunAvailable = hasBun()

function run(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null, stdout: string, stderr: string } {
  const cleanEnv = { ...process.env }
  for (const key of [
    'LOCAL',
    'DATABASE_URL',
    'NEON_HTTP_ENDPOINT',
    'DEVKIT_EXAMPLE_JSON',
  ])
    delete cleanEnv[key]
  const result = spawnSync('bun', [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      ...env,
    },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe.skipIf(!bunAvailable)('example CLI', () => {
  it('prints help with the configured name', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: devkit-example')
    expect(result.stdout).toContain('dev')
  })

  it('describes the command tree as JSON on stdout', () => {
    const result = run(['describe'])
    expect(result.status).toBe(0)
    const described = JSON.parse(result.stdout) as { name: string, version: string, groups: { name: string, commands: { id: string }[] }[] }
    expect(described.name).toBe('devkit-example')
    expect(described.version).toBe('0.1.0')
    expect(described.groups[0]?.commands.map(command => command.id)).toContain('dev.server')
  })

  it('lists the built-in dev commands', () => {
    const result = run(['dev', '--help'])
    expect(result.status).toBe(0)
    for (const command of ['server', 'db', 'proxy', 'storage'])
      expect(result.stdout).toContain(command)
  })

  it('writes a dry-run envelope for dev db', () => {
    const result = run(['dev', 'db', '--dry-run', '--json'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'dev.db',
      data: { applied: false },
      meta: { dryRun: true },
    })
  })

  it('returns exit code 2 for unknown commands', () => {
    const result = run(['nope'])
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
  })

  it('returns exit code 3 and a MISSING_ENV envelope without DATABASE_URL', () => {
    const result = run(['dev', 'proxy', '--dry-run', '--json'])
    expect(result.status).toBe(3)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'MISSING_ENV' },
    })
  })

  it('honors the implicit JSON switch', () => {
    const result = run(['dev', 'db', '--dry-run'], { DEVKIT_EXAMPLE_JSON: '1' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command: 'dev.db' })
  })

  it('starts a working local setup from the committed template', () => {
    copyFileSync(join(root, '.env.example'), join(cwd, '.env'))
    try {
      const result = run(['dev', 'proxy', '--dry-run', '--json'])
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        command: 'dev.proxy',
        data: { databaseUrl: 'postgres://postgres@localhost:5432/devkit_dev' },
      })
    }
    finally {
      rmSync(join(cwd, '.env'), { force: true })
    }
  })
})
