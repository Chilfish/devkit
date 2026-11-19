import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePackageBin, resolveServerSpawn } from '../../src/commands/index'
import { resolveBunBinary } from '../../src/local/index'

let dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devkit-spawn-'))
  dirs.push(dir)
  return dir
}

function touch(path: string, content = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writePackage(cwd: string, name: string, manifest: Record<string, unknown>): string {
  const dir = join(cwd, 'node_modules', name)
  touch(join(dir, 'package.json'), JSON.stringify(manifest))
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('resolvePackageBin', () => {
  it('reads a string bin entry', () => {
    const cwd = tempDir()
    const dir = writePackage(cwd, 'tool', { bin: './cli.js' })
    const entry = join(dir, 'cli.js')
    touch(entry)

    expect(resolvePackageBin('tool', cwd)).toBe(entry)
  })

  it('prefers the bin key matching the command', () => {
    const cwd = tempDir()
    const dir = writePackage(cwd, 'astro', {
      bin: { other: './other.js', astro: './bin/astro.mjs' },
    })
    const entry = join(dir, 'bin', 'astro.mjs')
    touch(entry)
    touch(join(dir, 'other.js'))

    expect(resolvePackageBin('astro', cwd)).toBe(entry)
  })

  it('returns undefined without a manifest or bin target', () => {
    const cwd = tempDir()
    writePackage(cwd, 'no-bin', { name: 'no-bin' })

    expect(resolvePackageBin('missing', cwd)).toBeUndefined()
    expect(resolvePackageBin('no-bin', cwd)).toBeUndefined()
  })
})

describe('resolveServerSpawn', () => {
  it('runs the package entry with the configured runtime', () => {
    const cwd = tempDir()
    const dir = writePackage(cwd, 'astro', {
      bin: { astro: 'bin/astro.mjs' },
    })
    const entry = join(dir, 'bin', 'astro.mjs')
    touch(entry)
    // A Windows shim that must never be passed to node.
    touch(join(cwd, 'node_modules', '.bin', 'astro.exe'), 'MZ')

    const plan = resolveServerSpawn(
      {
        runtime: 'node',
        command: 'astro',
        args: ['dev'],
      },
      ['--port', '4322'],
      cwd,
    )

    expect(plan.executable).toBe(process.env.NODE ?? 'node')
    expect(plan.args).toEqual([entry, 'dev', '--port', '4322'])
    expect(plan.shell).toBe(false)
  })

  it('uses the Bun executable for bun servers', () => {
    const cwd = tempDir()
    const dir = writePackage(cwd, 'app', { bin: 'index.js' })
    touch(join(dir, 'index.js'))

    const plan = resolveServerSpawn({ runtime: 'bun', command: 'app' }, [], cwd)
    expect(plan.executable).toBe(resolveBunBinary())
  })

  it('does not duplicate the runtime when the command is the runtime itself', () => {
    const cwd = tempDir()
    const plan = resolveServerSpawn({
      runtime: 'bun',
      command: 'bun',
      args: ['--cwd', 'apps/server', 'dev'],
    }, [], cwd)

    expect(plan.executable).toBe(resolveBunBinary())
    expect(plan.args).toEqual(['--cwd', 'apps/server', 'dev'])
  })

  it('runs an explicit path through the runtime', () => {
    const cwd = tempDir()
    const plan = resolveServerSpawn({
      runtime: 'node',
      command: './scripts/serve.ts',
      args: ['--x'],
    }, [], cwd)

    expect(plan.executable).toBe(process.env.NODE ?? 'node')
    expect(plan.args).toEqual(['./scripts/serve.ts', '--x'])
  })

  it('falls back to the bare command when nothing is installed', () => {
    const cwd = tempDir()
    const plan = resolveServerSpawn({ runtime: 'node', command: 'not-installed' }, [], cwd)

    expect(plan.executable).toBe(process.env.NODE ?? 'node')
    expect(plan.args).toEqual(['not-installed'])
  })

  it.skipIf(process.platform !== 'win32')('runs a Windows .exe shim directly', () => {
    const cwd = tempDir()
    const shim = join(cwd, 'node_modules', '.bin', 'tool.exe')
    touch(shim, 'MZ')

    const plan = resolveServerSpawn({ runtime: 'node', command: 'tool' }, ['dev'], cwd)

    expect(plan.executable).toBe(shim)
    expect(plan.args).toEqual(['dev'])
    expect(plan.shell).toBe(false)
  })
})
