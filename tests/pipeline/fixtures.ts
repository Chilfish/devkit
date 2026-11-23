/**
 * Shared fixtures for the pipeline tests.
 *
 * Delays use `setTimeout` because the runner never depends on wall-clock
 * ordering; assertions only check the concurrency ceiling and final statuses.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }, { once: true })
  })
}

/** Track the highest number of simultaneous handlers. */
export function createConcurrencyProbe(): {
  run: <T>(work: () => Promise<T>) => Promise<T>
  readonly peak: number
  readonly active: number
} {
  let active = 0
  let peak = 0
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      active += 1
      peak = Math.max(peak, active)
      try {
        return await work()
      }
      finally {
        active -= 1
      }
    },
    get peak(): number {
      return peak
    },
    get active(): number {
      return active
    },
  }
}
