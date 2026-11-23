import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildWindowsCommandLine,
  commandOutput,
  findBinary,
  firstExisting,
  isPortOpen,
  listDir,
  quoteWindowsArgument,
  readLogTail,
  resolveLogPath,
  sleep,
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

describe('filesystem helpers', () => {
  it('lists a directory and returns an empty array for a missing one', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.txt'), '')
    expect(listDir(dir).map(name => name.replace(`${dir}\\`, '').replace(`${dir}/`, ''))).toEqual(['a.txt'])
    expect(listDir(join(dir, 'missing'))).toEqual([])
  })

  it('returns the first existing path', () => {
    const dir = tempDir()
    const existing = join(dir, 'exists')
    writeFileSync(existing, '')
    expect(firstExisting([
      undefined,
      join(dir, 'nope'),
      existing,
    ])).toBe(existing)
    expect(firstExisting([
      undefined,
      join(dir, 'nope'),
    ])).toBeUndefined()
  })

  it('finds a binary across directories', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'tool.exe'), '')
    expect(findBinary([dir, undefined], ['tool.exe'])).toBe(join(dir, 'tool.exe'))
    expect(findBinary([dir], ['other.exe'])).toBeUndefined()
  })

  it('creates the parent directory for a log path', () => {
    const dir = tempDir()
    const path = resolveLogPath(join(dir, 'logs'), 'service.log')
    expect(path).toBe(join(dir, 'logs', 'service.log'))
    expect(listDir(join(dir, 'logs'))).toEqual([])
  })
})

describe('commandOutput', () => {
  it('returns trimmed stdout for a successful command', () => {
    const dir = tempDir()
    const script = join(dir, 'print.cjs')
    writeFileSync(script, 'console.log("  value  ")\n')
    expect(commandOutput(process.execPath, [script])).toBe('value')
  })

  it('returns undefined for a failing command', () => {
    const dir = tempDir()
    const script = join(dir, 'fail.cjs')
    writeFileSync(script, 'process.exit(1)\n')
    expect(commandOutput(process.execPath, [script])).toBeUndefined()
  })
})

describe('isPortOpen', () => {
  it('reports false for a closed port', async () => {
    expect(await isPortOpen('127.0.0.1', 1, 200)).toBe(false)
  })
})

describe('sleep', () => {
  it('resolves after the delay', async () => {
    const start = Date.now()
    await sleep(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
})
