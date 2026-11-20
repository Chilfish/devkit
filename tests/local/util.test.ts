import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildWindowsCommandLine,
  quoteWindowsArgument,
  readLogTail,
  spawnDetached,
} from '../../src/local/util'

let dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devkit-util-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('readLogTail', () => {
  it('returns an empty string for a missing file', () => {
    expect(readLogTail(join(tempDir(), 'missing.log'))).toBe('')
  })

  it('returns the last lines of a small file', () => {
    const path = join(tempDir(), 'small.log')
    writeFileSync(path, 'one\ntwo\nthree\n')
    expect(readLogTail(path, 2)).toBe('two\nthree')
  })

  it('reads only the tail window of a large file', () => {
    const path = join(tempDir(), 'large.log')
    const padding = 'x'.repeat(200)
    const lines = Array.from({ length: 2000 }, (_, index) => `${padding}-${index}`)
    writeFileSync(path, `${lines.join('\n')}\n`)

    // A 512-byte window holds two whole 205-byte lines; the partial first line is dropped.
    const tail = readLogTail(path, 3, 512)
    expect(tail.split('\n')).toEqual([`${padding}-1998`, `${padding}-1999`])
  })

  it('drops a partially read first line', () => {
    const path = join(tempDir(), 'cut.log')
    writeFileSync(path, `${'a'.repeat(100)}\nsecond\nthird\n`)

    const tail = readLogTail(path, 2, 12)
    expect(tail).toBe('third')
  })
})

describe('windows command line quoting', () => {
  it('quotes single arguments', () => {
    expect(quoteWindowsArgument('a b')).toBe('"a b"')
    expect(quoteWindowsArgument('say "hi"')).toBe('"say ""hi"""')
  })

  it('builds a foreground command line wrapped for cmd /s', () => {
    expect(buildWindowsCommandLine('C:\\tools\\x.cmd', ['dev', '--port=4322']))
      .toBe('""C:\\tools\\x.cmd" "dev" "--port=4322""')
  })
})

describe('spawnDetached', () => {
  it('appends child output to the log file and returns immediately', async () => {
    const dir = tempDir()
    const logFile = join(dir, 'service.log')

    spawnDetached({
      command: process.execPath,
      args: ['-e', 'console.log("detached-ok")'],
      logFile,
    })

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (readLogTail(logFile).includes('detached-ok'))
        break
      await new Promise(resolveSleep => setTimeout(resolveSleep, 50))
    }

    expect(readLogTail(logFile)).toContain('detached-ok')
  }, 20_000)
})
