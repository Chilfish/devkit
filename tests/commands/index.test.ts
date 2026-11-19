import type { CommandContext } from '../../src/cli/index'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/cli/index'
import { createDevCommands, resolveCommand } from '../../src/commands/index'
import { createConfig } from '../testkit/config'

const config = createConfig()

afterEach(() => {
  delete process.env.LOCAL
})

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    options: {},
    args: [],
    log: createLogger({
      name: 'test',
      write: () => {},
    }),
    dryRun: true,
    json: false,
    requireString: () => '',
    integer: (_name, fallback) => fallback,
    flag: () => false,
    toArgv: () => [],
    ...overrides,
  }
}

describe('createDevCommands', () => {
  const group = createDevCommands(config)

  it('exposes the built-in dev group', () => {
    expect(group.name).toBe('dev')
    expect(group.commands.map(command => command.id)).toEqual([
      'dev.server',
      'dev.db',
      'dev.proxy',
      'dev.storage',
    ])
  })

  it('gives every command a description and implementation', () => {
    for (const command of group.commands) {
      expect(command.description.length).toBeGreaterThan(0)
      expect(typeof command.run).toBe('function')
    }
  })

  it('does not add --local by default', () => {
    const server = group.commands.find(command => command.id === 'dev.server')
    expect(server?.options?.map(option => option.flags)).not.toContain('--local')
  })

  it('adds --local when requested', () => {
    const server = createDevCommands(config, { serverLocalFlag: true })
      .commands
      .find(command => command.id === 'dev.server')
    expect(server?.options?.map(option => option.flags)).toContain('--local')
    expect(server?.examples).toContain(`${config.identity.helpHint} dev server --local`)
  })

  it('applies string overrides without changing ids', () => {
    const overridden = createDevCommands(config, {
      strings: {
        groupDescription: '本地环境',
        commands: {
          server: {
            description: '启动开发服务器',
            details: '本地详情',
            examples: ['bun run ymmt dev server'],
          },
          db: {
            description: '初始化本地库',
            optionDescriptions: { url: '目标数据库地址' },
          },
        },
      },
    })

    expect(overridden.description).toBe('本地环境')
    const server = overridden.commands.find(command => command.id === 'dev.server')
    expect(server).toMatchObject({
      id: 'dev.server',
      description: '启动开发服务器',
      details: '本地详情',
      examples: ['bun run ymmt dev server'],
    })
    const db = overridden.commands.find(command => command.id === 'dev.db')
    expect(db?.description).toBe('初始化本地库')
    expect(db?.options?.[0]?.description).toBe('目标数据库地址')
  })

  it('switches the local flag when --local is used', async () => {
    const server = createDevCommands(config, { serverLocalFlag: true })
      .commands
      .find(command => command.id === 'dev.server')

    await server!.run(context({
      options: { local: true },
      flag: name => name === 'local',
    }))

    expect(process.env.LOCAL).toBe('1')
  })
})

describe('resolveCommand', () => {
  it('returns paths unchanged', () => {
    expect(resolveCommand('./scripts/serve.ts')).toBe('./scripts/serve.ts')
    expect(resolveCommand('C:\\tools\\serve.exe')).toBe('C:\\tools\\serve.exe')
  })

  it('returns the bare command when no local binary exists', () => {
    expect(resolveCommand('definitely-not-installed-bin')).toBe('definitely-not-installed-bin')
  })
})
