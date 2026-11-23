# Pipeline: bounded concurrency, stage state machine and resumable runs

> Status: implementing (2026-11-23). Entry: `@chilfish/devkit/pipeline` (node).
> This document is the contract for the new module; code and docs change together.

## 1. Problem

Downstream scripts (fetch / ingest / publish / validate) currently run their work
sequentially. Network-bound steps waste wall-clock time and CPU-bound steps use a
single core. Both kinds share the same failure mode: an interrupted run restarts
from zero, and there is no record of which item failed.

What is missing is one reusable executor that:

- runs items with bounded concurrency so CPU-bound work spreads across cores;
- keeps every stage and item in an explicit state machine;
- persists state so a killed run resumes at the last completed item;
- aggregates failures instead of aborting the whole batch on the first error.

## 2. Goals

| ID | Goal | Acceptance signal |
|---|---|---|
| P-1 | Bounded in-process concurrency | `concurrency: n` never has more than `n` handlers in flight |
| P-2 | Worker-thread parallelism for CPU-bound handlers | `worker` stages run on `concurrency` threads and saturate multiple cores |
| P-3 | Strict stage/item state machine | Illegal transitions throw `PipelineStateError`; transition matrix is unit-tested |
| P-4 | Durable state and resume | A second run with `resume: true` skips `succeeded` items and re-runs `running` / `failed` ones |
| P-5 | Failure aggregation | Per-item failures are recorded with key and error; the run finishes and reports `partial` / `failed` |
| P-6 | Cancellation | An external `AbortSignal` cancels pending items and terminates worker threads |
| P-7 | No new dependencies | Uses `node:worker_threads`, `node:fs/promises` and `AbortController` only |

## 3. Non-goals

- No DAG scheduling: stages run in declaration order. Cross-stage parallelism is a
  later addition if a second consumer needs it.
- No distributed execution: one process owns a run; `runId` is not a lock.
- No automatic retry of a whole stage; retries are per item.
- No CLI command: the module is a library. Hosts wire it into their own
  `CommandSpec`.

## 4. State machines

### 4.1 Stage

```
idle ──► running ──► succeeded
  │        │     ├─► failed
  │        │     ├─► partial
  │        │     └─► cancelled
  └──────► skipped            (only on resume of a stage that already succeeded)
```

| From | Allowed to |
|---|---|
| `idle` | `running`, `skipped` |
| `running` | `succeeded`, `failed`, `partial`, `cancelled` |
| `succeeded` / `failed` / `partial` / `cancelled` / `skipped` | none (terminal) |

### 4.2 Item

```
pending ──► running ──► succeeded
  │           │     ├─► failed
  │           │     ├─► cancelled
  │           │     └─► pending     (reset before a retry)
  ├───────► skipped                 (resume of an already-succeeded item)
  └───────► cancelled
```

| From | Allowed to |
|---|---|
| `pending` | `running`, `skipped`, `cancelled` |
| `running` | `succeeded`, `failed`, `cancelled`, `pending` (retry reset) |
| terminal | none |

Terminal states never transition again inside a run. Resume constructs a fresh
attempt from the stored snapshot instead of re-transitioning terminal states:

- stage `running` / `failed` / `partial` / `cancelled` → `idle`;
- stage `succeeded` / `skipped` → `skipped` (not executed);
- item `running` / `failed` → `pending`;
- item `succeeded` / `skipped` → `skipped` (not executed).

### 4.3 Run status

`running | succeeded | failed | partial | cancelled`.

Precedence when the run ends: external cancellation → `cancelled`; any stage
`failed` → `failed`; any stage `partial` → `partial`; otherwise `succeeded`.

## 5. API

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
      items: async function* () {
        for (const id of ids) yield id
      },
      key: id => String(id),
      run: async (id, ctx) => fetchOne(id, { signal: ctx.signal }),
    },
    {
      name: 'parse',
      concurrency: 4,
      worker: { entry: fileURLToPath(new URL('./parse-worker.ts', import.meta.url)), export: 'parseItem' },
      items: () => readRawIds(),
    },
  ],
})
```

### 5.1 `StageDefinition`

| Field | Required | Default | Meaning |
|---|---|---|---|
| `name` | yes | — | Unique within the run |
| `items` | yes | — | Enumerates items; may be sync/async, iterable or a promise |
| `run` | inline only | — | In-process handler |
| `worker` | worker only | — | `{ entry, export }`; `entry` is an absolute module path |
| `key` | no | `JSON.stringify(item)` | Stable identity for resume and dedupe |
| `concurrency` | no | `4` | Upper bound of in-flight items |
| `retries` | no | `0` | Extra attempts after the first failure |
| `timeoutMs` | no | none | Per-attempt timeout; worker threads are terminated |
| `failFast` | no | `false` | Stop dispatching the rest of this stage after a failure |

Exactly one of `run` / `worker` must be provided. A `worker.entry` must be an
absolute path or `file:` URL. Keys must be unique within a stage; duplicates are
a configuration error.

Run-level options: `runId`, `stages`, `store`, `resume`, `signal`,
`persistIntervalMs` (default 1000) and `onEvent`.

### 5.2 Handler context

```ts
interface ItemContext {
  stage: string
  key: string
  attempt: number      // 1-based
  maxAttempts: number  // retries + 1
  signal: AbortSignal
}
```

In worker threads `signal` exists but never aborts: cancellation terminates the
thread. Handlers must be pure and receive everything through the item.

### 5.3 Snapshot

```ts
interface PipelineSnapshot {
  version: 1
  runId: string
  status: PipelineStatus
  startedAt: string
  updatedAt: string
  stages: Record<string, {
    name: string
    status: StageStatus
    startedAt?: string
    finishedAt?: string
    items: Record<string, {
      key: string
      status: ItemStatus
      attempts: number
      startedAt?: string
      finishedAt?: string
      error?: { message: string, code?: string, stack?: string }
    }>
  }>
}
```

### 5.4 Events and results

`onEvent` receives discriminated `PipelineEvent`s (`pipeline` / `stage` / `item`)
with `from`, `to` and `attempts`, so a host can render progress.

`PipelineResult` carries `runId`, `status`, `exitCode` (0 when `succeeded`),
per-stage counters (`succeeded` / `failed` / `skipped` / `cancelled`),
`failures: { key, error }[]` and `durationMs`.

## 6. Persistence and resume

`PipelineStore` is `{ load(runId), save(snapshot), flush?() }`.
`createFilePipelineStore({ dir, flushIntervalMs })` writes one JSON snapshot per
run with an atomic temp-file + rename and serialized writes; `save` calls inside
the flush window are coalesced. `runId` is restricted to `[A-Za-z0-9._-]`.
`createMemoryPipelineStore()` is the in-memory equivalent (with `peek`), used by
the tests and the example.

Resume rules:

1. `resume: true` loads the snapshot and applies §4.2 resets.
2. `succeeded` items are counted as skipped and never dispatched.
3. Enumeration still runs, so `items()` must be deterministic for a given `runId`.
4. A corrupt snapshot fails the run instead of silently starting over.
5. Without `resume`, an existing snapshot is overwritten.

## 7. Worker protocol

- The package ships a generic worker entry (`dist/pipeline/worker-entry.js`,
  built from `src/pipeline/worker-entry.ts`) next to `dist/pipeline/index.js`,
  resolved from the module location, never from `cwd`. It is a build output, not
  a public export.
- Each worker loads the stage's handler module once (`import(fileUrl)`) and
  validates that the named export is a function.
- Messages: `{ id, item, ctx }` down, `{ id, ok, result | error }` up. `id`
  prevents a late reply from a timed-out task from being attributed to the next.
- On timeout, handler crash or worker exit, the in-flight item fails and the
  worker is replaced.
- `destroy()` rejects in-flight and queued items with `PipelineCancelledError`.

## 8. Tests

| File | Covers |
|---|---|
| `tests/pipeline/state.test.ts` | Transition matrix, illegal transitions, resume reset |
| `tests/pipeline/store.test.ts` | Atomic write, coalescing, corrupt snapshot, runId validation |
| `tests/pipeline/runner.test.ts` | Concurrency ceiling, retries, failFast, partial/failed status, resume, cancellation |
| `tests/pipeline/worker.test.ts` | Parallel execution against a real `node:worker_threads` fixture, timeout is not implemented there, so failure/replace is covered by protocol tests |

## 9. Follow-ups

- Optional `dependsOn` between stages once a consumer needs a DAG.
- Optional shared queue instead of per-stage worker pools.
- Cross-process locking if two commands can share a `runId`.
