import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveBunBinary, resolveProxyEntry } from '../../src/local/index'

describe('resolveProxyEntry', () => {
  it('resolves an existing entry relative to the module, not to cwd', () => {
    const entry = resolveProxyEntry()
    expect(existsSync(entry)).toBe(true)
    expect(entry.replaceAll('\\', '/')).toMatch(/src\/bin\/proxy\.(ts|js)$/)
  })
})

describe('resolveBunBinary', () => {
  it('returns a non-empty executable', () => {
    expect(resolveBunBinary().length).toBeGreaterThan(0)
  })
})
