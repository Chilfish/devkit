import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
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

/** Last `lines` lines of a log file, or an empty string when missing. */
export function readLogTail(path: string, lines = 10): string {
  if (!existsSync(path))
    return ''
  return readFileSync(path, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n')
}
