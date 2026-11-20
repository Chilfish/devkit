import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findProjectRoot, resolvePackageBin, resolveServerSpawn } from '../../src/commands/index'
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

describe('findProjectRoot', () => {
  it('walks up to the directory that owns node_modules', () => {
    const root = tempDir()
    touch(join(root, 'package.json'), '{}')
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    const nested = join(root, 'apps', 'web', 'src')
    mkdirSync(nested, { recursive: true })
    touch(join(root, 'apps', 'web', 'package.json'), '{}')

    expect(findProjectRoot(nested)).toBe(root)
  })

  it('falls back to the nearest package.json', () => {
    const root = tempDir()
    touch(join(root, 'package.json'), '{}')
    const nested = join(root, 'scripts')
    mkdirSync(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(root)
  })

  it('prefers the package root that owns node_modules over a nested package.json', () => {
    const root = tempDir()
    touch(join(root, 'package.json'), '{}')
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    const nested = join(root, 'apps', 'web')
    mkdirSync(nested, { recursive: true })
    touch(join(nested, 'package.json'), '{}')

    expect(findProjectRoot(nested)).toBe(root)
  })

  it('ignores a stray node_modules above the project', () => {
    const root = tempDir()
    const project = join(root, 'project')
    mkdirSync(project, { recursive: true })
    touch(join(project, 'package.json'), '{}')
    mkdirSync(join(root, 'node_modules'), { recursive: true })

    expect(findProjectRoot(project)).toBe(project)
  })

  it('returns the starting directory when nothing is found', () => {
    const root = tempDir()
    const nested = join(root, 'lonely')
    mkdirSync(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(nested)
  })

  it('resolves a server from a nested working directory', () => {
    const root = tempDir()
    touch(join(root, 'package.json'), '{}')
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    const dir = writePackage(root, 'astro', {
      bin: { astro: 'bin/astro.mjs' },
    })
    const entry = join(dir, 'bin', 'astro.mjs')
    touch(entry)
    const nested = join(root, 'apps', 'web')
    mkdirSync(nested, { recursive: true })

    const previous = process.cwd()
    process.chdir(nested)
    try {
      const plan = resolveServerSpawn({ runtime: 'node', command: 'astro' })
      expect(plan.args[0]).toBe(entry)
    }
    finally {
      process.chdir(previous)
    }
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

  it.skipIf(process.platform !== 'win32')('runs a .cmd shim through cmd.exe with quoted arguments', () => {
    const cwd = tempDir()
    const shim = join(cwd, 'node_modules', '.bin', 'tool.cmd')
    touch(shim, '@echo off')

    const plan = resolveServerSpawn({ runtime: 'node', command: 'tool' }, ['dev', '--flag=a b'], cwd)

    expect(plan.executable).toMatch(/cmd\.exe$/i)
    expect(plan.shell).toBe(false)
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(plan.args[3]).toContain('--flag=a b')
    expect(plan.args[3]?.startsWith('"')).toBe(true)
  })
})
