/**
 * Worker handler fixture loaded by `worker.test.ts`.
 *
 * The module is imported by absolute path inside a worker thread, so it must be
 * plain module code with named exports and no test-runner globals.
 */
import { parentPort, threadId } from 'node:worker_threads'

export function square(item: number): number {
  return item * item
}

/** Reports which thread handled the item so the test can prove parallelism. */
export function thread(item: { id: number, delayMs: number }): Promise<{ id: number, threadId: number }> {
  return new Promise((resolve) => {
    setTimeout(resolve, item.delayMs, { id: item.id, threadId })
  })
}

export function fail(item: string): void {
  throw new Error(`worker rejected ${item}`)
}

export function busyUntil(item: { id: number, spinMs: number }): number {
  const end = Date.now() + item.spinMs
  let counter = 0
  while (Date.now() < end) counter += 1
  return counter + item.id
}

/** Keeps the process alive check honest: a worker that posts before exit. */
export function reportPort(): boolean {
  return parentPort !== null
}

export const notAFunction = 42
