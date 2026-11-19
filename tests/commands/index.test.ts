import { describe, expect, it } from 'vitest'
import { createDevCommands, resolveCommand } from '../../src/commands/index'
import { createConfig } from '../testkit/config'

describe('createDevCommands', () => {
  const group = createDevCommands(createConfig())

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
