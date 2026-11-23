import { defineDevkit } from '../src/index'

const devkit = defineDevkit({
  identity: {
    name: 'devkit',
    description: 'Demo project',
  },
  env: { file: '.env' },
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
})

console.log(devkit.identity.name)
console.log(devkit.database.localUrl)
console.log(devkit.dev.servers.map(server => server.command).join(', '))
