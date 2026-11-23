# Pipeline: bounded concurrency and resumable stages

`@chilfish/devkit/pipeline` runs a list of stages with bounded concurrency, an
explicit stage/item state machine and durable snapshots. It is Node-only: worker
stages use `node:worker_threads` and the file store uses `node:fs`.

## Quick start

```ts
import { runPipeline, createFilePipelineStore } from '@chilfish/devkit/pipeline'

const store = createFilePipelineStore({ dir: 'temp/pipeline' })

const result = await runPipeline({
  runId: 'ingest-2026-11-23',
  store,
  resume: true,
  stages: [
    {
      name: 'fetch',
      concurrency: 8,
      retries: 2,
      timeoutMs: 30_000,
      items: ids,
      key: id => String(id),
      run: async (id, ctx) => fetchOne(id, { signal: ctx.signal }),
    },
    {
      name: 'parse',
      concurrency: 4,
      items: parseTargets,
      worker: { entry: '/abs/path/parse-worker.js', export: 'parseItem' },
    },
  ],
})

if (result.status !== 'succeeded')
  process.exitCode = result.exitCode
```

## Execution model

- Stages run **in declaration order**. Items inside a stage run with at most
  `concurrency` handlers in flight.
- `run` handlers run in-process; they share the event loop, so use them for I/O.
- `worker` handlers run on `concurrency` worker threads and use real cores. The
  worker entry must be an absolute path or `file:` URL and export a function
  named by `worker.export` (default `run`).
- Item failures are recorded and the stage continues (unless `failFast` is set).
  The run resolves instead of throwing; read `result.status`, `result.exitCode`
  and `result.failures`.

## Stage options

| Field | Default | Meaning |
|---|---|---|
| `name` | — | Unique stage id; snapshot key |
| `items` | — | Iterable, async iterable or promise of either |
| `run` | — | In-process handler; exactly one of `run` / `worker` |
| `worker` | — | `{ entry, export? }`; absolute path or `file:` URL |
| `key` | `JSON.stringify(item)` | Stable identity; must be unique per stage |
| `concurrency` | `4` | Maximum in-flight items (threads for `worker` stages) |
| `retries` | `0` | Extra attempts after a failure |
| `timeoutMs` | none | Per-attempt timeout; worker threads are terminated |
| `failFast` | `false` | Stop dispatching the rest of the stage after a failure |

## State machine

Stages: `idle → running → succeeded | failed | partial | cancelled`; `idle → skipped`
on resume. Items: `pending → running → succeeded | failed | cancelled`, plus
`running → pending` for a retry reset, and `pending → skipped` on resume.

Illegal transitions throw `PipelineStateError` (`code: INVALID_TRANSITION`), so a
retry or resume cannot silently corrupt progress.

Run status precedence: cancellation → `cancelled`; any failed stage → `failed`;
any partial stage → `partial`; otherwise `succeeded`. `exitCode` is 0 only for
`succeeded`.

## Persistence and resume

`createFilePipelineStore({ dir, flushIntervalMs })` writes `<runId>.json` with a
temp-file + rename, coalesces saves inside the flush window and serializes
snapshot content at `save` time. `runId` must match `[A-Za-z0-9._-]`.

With `resume: true`:

- a `succeeded` / `skipped` stage is not executed (`skipped`);
- a `succeeded` / `skipped` item is not dispatched (`skipped`);
- `running` / `failed` / `cancelled` items are reset and retried;
- enumeration still runs, so `items()` must be deterministic for a `runId`;
- a corrupt or mismatched snapshot fails the run instead of starting over.

`createMemoryPipelineStore()` is the in-memory equivalent for tests and examples;
its `peek(runId)` returns a copy of the stored snapshot.

## Cancellation

Pass an `AbortSignal`; pending items stop, in-flight items receive the signal and
worker threads are terminated. A cancelled run finishes with status `cancelled`.

In-process timeouts abort the handler's `ctx.signal` and fail the attempt; a
handler that ignores the signal keeps running, so check the signal in long I/O.
Worker timeouts terminate the thread.

## Events

`onEvent` receives discriminated events for every declared transition:

```ts
onEvent(event) {
  if (event.kind === 'item')
    console.log(`${event.stage} ${event.key}: ${event.from} -> ${event.to} (attempt ${event.attempt})`)
}
```

A throwing callback never changes the run result.

## Errors

| Class | `code` | Raised for |
|---|---|---|
| `PipelineConfigError` | `INVALID_PIPELINE` | Bad definition: no stages, duplicate names/keys, both or neither of `run` / `worker`, relative worker entry, invalid concurrency/retries/timeout |
| `PipelineStateError` | `INVALID_TRANSITION` | Illegal stage or item transition |
| `PipelineCancelledError` | `CANCELLED` | Signal fired or the worker pool closed |
| `PipelineTimeoutError` | `TIMEOUT` | Attempt exceeded `timeoutMs` |
| `PipelineWorkerError` | `WORKER` | Worker failed to load, crashed or exited |
| `PipelineStoreError` | `STORE` / `CORRUPT_SNAPSHOT` | Snapshot read/write failure or corrupt data |
