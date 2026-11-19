import type { DevkitConfig, DevkitConfigInput } from '../../src/index'
import { defineDevkit } from '../../src/index'

export function createConfigInput(overrides: Partial<DevkitConfigInput> = {}): DevkitConfigInput {
  return {
    identity: {
      name: 'devkit-test',
      description: 'devkit test project',
    },
    env: { file: '.dev.vars' },
    database: {
      localUrl: 'postgres://postgres@localhost:5432/devkit_dev',
      proxyEndpoint: 'http://127.0.0.1:4444/sql',
      migrations: 'drizzle',
    },
    storage: { bucket: 'devkit-data', publicBaseEnv: 'PUBLIC_BASE' },
    dev: {
      servers: [
        {
          name: 'astro',
          command: 'astro',
          args: ['dev'],
        },
      ],
    },
    ...overrides,
  }
}

export function createConfig(overrides: Partial<DevkitConfigInput> = {}): DevkitConfig {
  return defineDevkit(createConfigInput(overrides))
}
