import { describe, expect, it } from 'vitest'
import { defineDevkit, DevkitConfigError } from '../src/index'
import { createConfigInput } from './testkit/config'

describe('defineDevkit', () => {
  it('applies documented defaults', () => {
    const config = defineDevkit(createConfigInput())

    expect(config.identity.helpHint).toBe('bun run devkit-test')
    expect(config.env.localFlag).toBe('LOCAL')
    expect(config.env.onlineSuffix).toBe('_ONLINE')
    expect(config.storage.dataDir).toBe('temp/silo-data')
    expect(config.paths.logs).toBe('logs')
    expect(config.dev.servers[0]?.runtime).toBe('node')
    expect(config.dev.servers[0]?.args).toEqual(['dev'])
  })

  it('keeps explicit values', () => {
    const config = defineDevkit(createConfigInput({
      identity: {
        name: 'ymmt',
        description: 'pipeline',
        helpHint: 'bun run ymmt',
        jsonEnvVar: 'YMMT_JSON',
      },
      env: { file: '.env', localFlag: 'IS_LOCAL', onlineSuffix: '' },
      paths: { logs: 'temp' },
      dev: {
        servers: [
          { name: 'app', runtime: 'bun', command: 'vite' },
        ],
      },
    }))

    expect(config.identity.helpHint).toBe('bun run ymmt')
    expect(config.identity.jsonEnvVar).toBe('YMMT_JSON')
    expect(config.env.localFlag).toBe('IS_LOCAL')
    expect(config.env.onlineSuffix).toBe('')
    expect(config.paths.logs).toBe('temp')
    expect(config.dev.servers[0]?.runtime).toBe('bun')
    expect(config.dev.servers[0]?.args).toEqual([])
  })

  it('freezes the result deeply', () => {
    const config = defineDevkit(createConfigInput())

    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.database)).toBe(true)
    expect(Object.isFrozen(config.dev.servers)).toBe(true)
  })

  it('rejects a non-local database URL', () => {
    const input = createConfigInput({
      database: {
        localUrl: 'postgres://user@db.example.com:5432/app',
        proxyEndpoint: 'http://127.0.0.1:4444/sql',
        migrations: 'drizzle',
      },
    })

    expect(() => defineDevkit(input)).toThrow(DevkitConfigError)
    expect(() => defineDevkit(input)).toThrow(/database.localUrl/)
  })

  it('rejects a non-local proxy endpoint', () => {
    const input = createConfigInput({
      database: {
        localUrl: 'postgres://postgres@localhost:5432/devkit_dev',
        proxyEndpoint: 'https://proxy.example.com/sql',
        migrations: 'drizzle',
      },
    })

    expect(() => defineDevkit(input)).toThrow(/database.proxyEndpoint/)
  })

  it('reports the offending field', () => {
    try {
      defineDevkit(createConfigInput({
        identity: { name: '', description: 'x' },
      }))
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(DevkitConfigError)
      expect((error as DevkitConfigError).field).toBe('identity.name')
    }
  })

  it('allows a project without dev servers', () => {
    const config = defineDevkit(createConfigInput({
      dev: { servers: [] },
    }))
    expect(config.dev.servers).toEqual([])
    expect(defineDevkit(createConfigInput({ dev: undefined })).dev.servers).toEqual([])
  })

  it('rejects a non-array server list', () => {
    expect(() => defineDevkit(createConfigInput({
      dev: { servers: 'nope' as unknown as [] },
    }))).toThrow(/dev.servers/)
  })
})
