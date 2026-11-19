/**
 * Environment example: load the env file, then print the banner.
 *
 *   LOCAL=1 bun examples/env.ts
 */
import { describeEnvironment, loadEnvFile } from '../src/env/index'
import { devkit } from './dev.config'

loadEnvFile({ config: devkit, log: false })
console.log(describeEnvironment(process.env, devkit))
