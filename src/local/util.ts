import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'

export function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

/** Run a short-lived command and return trimmed stdout, or undefined on failure. */
export function commandOutput(command: string, args: string[]): string | undefined {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  if (result.status !== 0)
    return undefined
  return result.stdout.trim()
}

export function listDir(path: string): string[] {
  try {
    return readdirSync(path).map(name => join(path, name))
  }
  catch {
    return []
  }
}

export function firstExisting(paths: (string | undefined)[]): string | undefined {
  return paths.find(path => path !== undefined && existsSync(path))
}

export function findBinary(dirs: (string | undefined)[], names: string[]): string | undefined {
  const paths = dirs.flatMap(dir => (dir
    ? names.map(name => join(dir, name))
    : []))
  return firstExisting(paths)
}

/** Test whether a TCP port accepts connections. */
export async function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return await new Promise((resolvePort) => {
    const socket = connect({ host, port })
    const finish = (open: boolean): void => {
      socket.destroy()
      resolvePort(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** Absolute path of a log file inside the configured log directory. */
export function resolveLogPath(logsDir: string, name: string): string {
  const path = resolve(logsDir, name)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

const TAIL_WINDOW_BYTES = 64 * 1024

/**
 * Last `lines` lines of a log file, or an empty string when missing.
 *
 * Reads only the tail window, so a multi-megabyte Postgres log does not get
 * loaded into memory on a failure path.
 */
export function readLogTail(path: string, lines = 10, windowBytes = TAIL_WINDOW_BYTES): string {
  if (!existsSync(path))
    return ''

  const fd = openSync(path, 'r')
  try {
    const { size } = fstatSync(fd)
    const length = Math.min(size, windowBytes)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)

    const text = buffer.toString('utf8')
    const newline = size > length
      ? text.indexOf('\n')
      : -1
    const tail = newline === -1
      ? text
      : text.slice(newline + 1)
    return tail.trimEnd().split(/\r?\n/).slice(-lines).join('\n')
  }
  finally {
    closeSync(fd)
  }
}

/** Quote one argument for `cmd.exe`. */
export function quoteWindowsArgument(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Command line passed to `cmd.exe /d /s /c`; the outer quotes are required by `/s`. */
export function buildWindowsCommandLine(command: string, args: string[]): string {
  return `"${[command, ...args].map(quoteWindowsArgument).join(' ')}"`
}

export interface SpawnDetachedOptions {
  command: string
  args: string[]
  logFile: string
  env?: NodeJS.ProcessEnv
  cwd?: string
}

/**
 * Start a background service that survives the parent process.
 *
 * `detached` plus `unref()` is enough on every platform, including Windows.
 * `cmd /c start` is deliberately avoided: it drops the inherited log
 * descriptor, so `dev-proxy.log` and `silo.log` stayed empty.
 */
export function spawnDetached(options: SpawnDetachedOptions): void {
  const fd = openSync(options.logFile, 'a')
  try {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd ?? process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: options.env ?? process.env,
    })
    child.unref()
  }
  finally {
    closeSync(fd)
  }
}
