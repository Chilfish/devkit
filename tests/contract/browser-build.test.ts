import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const sharedEntry = fileURLToPath(new URL('../../src/shared/index.ts', import.meta.url))
const rootEntry = fileURLToPath(new URL('../../src/index.ts', import.meta.url))

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
let outDir: string | undefined

afterEach(() => {
  if (outDir)
    rmSync(outDir, { recursive: true, force: true })
  outDir = undefined
})

/** Bundle an entry for the browser and return the emitted code. */
function buildForBrowser(entry: string): string {
  outDir = mkdtempSync(join(tmpdir(), 'devkit-browser-'))
  execFileSync('bun', [
    'build',
    entry,
    '--target=browser',
    '--format=esm',
    '--outdir',
    outDir,
  ], {
    stdio: 'pipe',
  })
  const [file] = readdirSync(outDir)
  expect(file).toBeDefined()
  return readFileSync(join(outDir, file as string), 'utf8')
}

describe.skipIf(!bunAvailable)('runtime boundary', () => {
  it('builds ./shared for the browser without node or bun builtins', () => {
    const code = buildForBrowser(sharedEntry)
    expect(code).not.toMatch(/(?:from|require\()\s*['"](?:node:|bun:)/)
  })

  it('builds the root entry for the browser without node or bun builtins', () => {
    const code = buildForBrowser(rootEntry)
    expect(code).not.toMatch(/(?:from|require\()\s*['"](?:node:|bun:)/)
  })
})
