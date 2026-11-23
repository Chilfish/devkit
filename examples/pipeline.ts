/**
 * Pipeline example: two stages, bounded concurrency, resumable snapshots.
 *
 *   bun examples/pipeline.ts          # all items succeed
 *   bun examples/pipeline.ts --fail   # one item fails, status becomes partial
 *
 * The worker stage is deliberately absent: a worker handler needs its own
 * module on disk, which the example would otherwise have to generate. See
 * docs/guide/pipeline.md for the worker form.
 */
import { fileURLToPath } from 'node:url'
import { createFilePipelineStore, runPipeline } from '../src/pipeline/index'

const store = createFilePipelineStore({
  dir: fileURLToPath(new URL('../temp/pipeline-example', import.meta.url)),
})

async function main(): Promise<void> {
  const fail = process.argv.includes('--fail')
  const result = await runPipeline({
    runId: 'example',
    store,
    stages: [
      {
        name: 'fetch',
        concurrency: 4,
        retries: 1,
        items: [1, 2, 3, 4, 5],
        async run(id) {
          await new Promise(resolve => setTimeout(resolve, 10))
          if (fail && id === 5)
            throw new Error(`item ${id} failed on purpose`)
          return id * 2
        },
      },
      {
        name: 'transform',
        concurrency: 2,
        items: [1, 2, 3],
        run: id => id + 100,
      },
    ],
  })

  console.log(JSON.stringify(result, null, 2))
  if (fail && result.status === 'succeeded')
    throw new Error('--fail should have reported a partial run')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
