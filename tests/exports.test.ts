import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface ConditionalExport {
  import: { types: string, default: string }
  require: { types: string, default: string }
}

interface PackageManifest {
  name: string
  version: string
  sideEffects?: boolean
  files?: string[]
  engines?: Record<string, string>
  exports: Record<string, ConditionalExport | string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const manifest: PackageManifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
)

/** The public entry matrix; adding or removing an entry is a contract change. */
const ENTRIES = [
  '.',
  './shared',
  './cli',
  './env',
  './local',
  './proxy',
  './storage',
  './commands',
] as const

describe('package manifest', () => {
  it('is the published package', () => {
    expect(manifest.name).toBe('@chilfish/devkit')
    expect(manifest.version).toBe('0.1.0')
  })

  it('marks the package as side-effect free', () => {
    expect(manifest.sideEffects).toBe(false)
  })

  it('publishes only the build output and docs', () => {
    expect(manifest.files).toEqual(['LICENSE.md', 'README.md', 'dist'])
  })

  it('declares the supported node range', () => {
    expect(manifest.engines?.node).toBe('>=22.22')
  })

  it.each(ENTRIES)('exposes typed ESM and CJS entry points for %s', (entry) => {
    const target = manifest.exports[entry]
    const base = entry === '.'
      ? 'index'
      : `${entry.slice(2)}/index`

    expect(target).toEqual({
      import: { types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` },
      require: { types: `./dist/${base}.d.cts`, default: `./dist/${base}.cjs` },
    })
  })

  it('exposes the proxy bin and package.json without types', () => {
    expect(manifest.exports['./bin/proxy']).toBe('./dist/bin/proxy.js')
    expect(manifest.exports['./package.json']).toBe('./package.json')
  })

  it('does not declare unexpected entries', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(
      [...ENTRIES, './package.json', './bin/proxy'].sort(),
    )
  })

  it('keeps command and storage dependencies bundled', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(['aws4fetch', 'commander'])
  })

  it('treats database dependencies as optional peers', () => {
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual(['drizzle-orm', 'pg'])
    expect(manifest.peerDependenciesMeta?.pg?.optional).toBe(true)
    expect(manifest.peerDependenciesMeta?.['drizzle-orm']?.optional).toBe(true)
  })
})
