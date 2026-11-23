import { defineDevkit } from '../src/index'

/** Shared example config, also used by the CLI and proxy examples. */
export const devkit = defineDevkit({
  identity: {
    name: 'devkit-example',
    description: 'devkit example project',
    helpHint: 'bun examples/cli.ts',
    jsonEnvVar: 'DEVKIT_EXAMPLE_JSON',
  },
  env: { file: '.env' },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/devkit_example',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'drizzle',
  },
  storage: {
    bucket: 'devkit-example',
    dataDir: 'temp/silo-data',
    publicBaseEnv: 'PUBLIC_BASE',
  },
  paths: { logs: 'temp/logs' },
  dev: {
    servers: [
      {
        name: 'app',
        runtime: 'node',
        command: 'node',
        args: ['-e', 'console.log("app would run here")'],
      },
    ],
  },
})
