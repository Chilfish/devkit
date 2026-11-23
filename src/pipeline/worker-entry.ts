import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
/**
 * Worker thread entry.
 *
 * The parent passes `{ handler, exportName }` through `workerData`; this module
 * loads the handler once and then answers one task at a time. The handler module
 * is loaded by absolute file URL, never from `cwd`, so a consumer project cannot
 * capture resolution.
 */
import { parentPort, workerData } from 'node:worker_threads'

interface WorkerData {
  handler: string
  exportName: string
}

interface SerializedError {
  message: string
  stack?: string
  code?: string
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
    return {
      message: error.message,
      ...(error.stack
        ? { stack: error.stack }
        : {}),
      ...(code
        ? { code }
        : {}),
    }
  }
  return {
    message: String(error),
  }
}

function handlerUrl(value: string): string {
  return value.startsWith('file:')
    ? value
    : pathToFileURL(resolve(value)).href
}

const port = parentPort

if (!port) {
  throw new Error('pipeline worker entry must be started as a worker thread')
}
else {
  void main()
}

async function main(): Promise<void> {
  const data = workerData as WorkerData
  let handler: (item: unknown, ctx: unknown) => unknown
  try {
    const module = await import(handlerUrl(data.handler)) as Record<string, unknown>
    const candidate = module[data.exportName]
    if (typeof candidate !== 'function')
      throw new TypeError(`Export "${data.exportName}" of ${data.handler} is not a function`)
    handler = candidate as (item: unknown, ctx: unknown) => unknown
  }
  catch (error) {
    port!.postMessage({
      type: 'init-error',
      error: serializeError(error),
    })
    return
  }

  port!.postMessage({ type: 'ready' })

  port!.on('message', async (message: WorkerMessage) => {
    if (!message || message.type !== 'task')
      return
    let reply: unknown
    try {
      const result = await handler(message.item, message.ctx)
      reply = {
        type: 'result',
        id: message.id,
        ok: true,
        result,
      }
    }
    catch (error) {
      reply = {
        type: 'result',
        id: message.id,
        ok: false,
        error: serializeError(error),
      }
    }

    try {
      port!.postMessage(reply)
    }
    catch (error) {
      port!.postMessage({
        type: 'result',
        id: message.id,
        ok: false,
        error: serializeError(
          new Error(`Result for ${message.id} is not structured-cloneable: ${error instanceof Error
            ? error.message
            : String(error)}`),
        ),
      })
    }
  })
}

interface WorkerMessage {
  type: 'task'
  id: number
  item: unknown
  ctx: unknown
}
