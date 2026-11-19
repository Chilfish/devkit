/**
 * Local stack example. Dry-run by default so it is safe to run anywhere:
 *
 *   bun examples/local.ts            # report the plan
 *   LOCAL=1 DEVKIT_EXAMPLE_APPLY=1 bun examples/local.ts  # actually start the stack
 */
import { ensureDevServices } from '../src/local/index'
import { devkit } from './dev.config'

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run') || process.env.DEVKIT_EXAMPLE_APPLY !== '1'
  const result = await ensureDevServices({ config: devkit, dryRun })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
