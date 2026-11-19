import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findProxyEntry, resolveBunBinary, resolveProxyEntry } from '../../src/local/index'

let dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devkit-proxy-entry-'))
  dirs.push(dir)
  return dir
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('findProxyEntry', () => {
  it('finds the entry from the bundled dist layout', () => {
    const root = tempDir()
    const entry = join(root, 'dist', 'bin', 'proxy.js')
    touch(entry)

    expect(findProxyEntry(join(root, 'dist'))).toBe(entry)
  })

  it('finds the entry from a package root with dist/bin', () => {
    const root = tempDir()
    const entry = join(root, 'dist', 'bin', 'proxy.js')
    touch(entry)

    expect(findProxyEntry(root)).toBe(entry)
  })

  it('finds the source entry by walking up from src/local', () => {
    const root = tempDir()
    const entry = join(root, 'src', 'bin', 'proxy.ts')
    touch(entry)

    expect(findProxyEntry(join(root, 'src', 'local'))).toBe(entry)
  })

  it('returns undefined when nothing matches', () => {
    const root = tempDir()
    expect(findProxyEntry(root)).toBeUndefined()
  })
})

describe('resolveProxyEntry', () => {
  it('resolves an existing entry relative to the module, not to cwd', () => {
    const entry = resolveProxyEntry()
    expect(existsSync(entry)).toBe(true)
    expect(entry.replaceAll('\\', '/')).toMatch(/bin\/proxy\.(ts|js)$/)
  })
})

describe('resolveBunBinary', () => {
  it('returns a non-empty executable', () => {
    expect(resolveBunBinary().length).toBeGreaterThan(0)
  })
})
