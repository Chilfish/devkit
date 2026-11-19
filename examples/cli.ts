/**
 * Full CLI wiring, exactly as documented:
 *
 *   bun examples/cli.ts --help
 *   bun examples/cli.ts describe
 *   bun examples/cli.ts dev db --dry-run --json
 */
import { buildCli, runCli } from '../src/cli/index'
import { createDevCommands } from '../src/commands/index'
import { devkit } from './dev.config'

const groups = [
  createDevCommands(devkit),
]

await runCli(
  buildCli({ config: devkit, version: '0.1.0', groups }),
  process.argv.slice(2),
)
