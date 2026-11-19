import { afterEach, describe, expect, it } from 'vitest'
import { describeCli, EXIT_CODES, requireEnv, requireEnvVar } from '../../src/cli/index'
import { createConfig } from '../testkit/config'

const config = createConfig()

afterEach(() => {
  delete process.env.DEVKIT_REQUIRE_ENV
})

describe('requireEnv', () => {
  it('returns the value when set', () => {
    process.env.DEVKIT_REQUIRE_ENV = 'value'
    expect(requireEnv('DEVKIT_REQUIRE_ENV')).toBe('value')
  })

  it('throws a plain Error so the runtime maps it to exit code 1', () => {
    try {
      requireEnv('DEVKIT_REQUIRE_ENV', 'missing for the test')
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toHaveProperty('exitCode')
      expect((error as Error).message).toBe('missing for the test')
    }
  })

  it('differs from requireEnvVar, which reports a config error', () => {
    try {
      requireEnvVar('DEVKIT_REQUIRE_ENV')
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(EXIT_CODES.config)
    }
  })
})

describe('describeCli labels', () => {
  it('uses defaults when no labels are given', () => {
    const described = describeCli({ config, version: '1.0.0' })
    expect(described.exitCodes[0]?.meaning).toBe('success / already converged')
    expect(described.globalOptions[0]?.description).toBe('write a single-line JSON envelope to stdout')
  })

  it('replaces exit codes and global options', () => {
    const described = describeCli({
      config,
      version: '1.0.0',
      labels: {
        exitCodes: [
          { code: 0, meaning: 'ok' },
        ],
        globalOptions: [
          { flags: '--json', description: 'json output' },
        ],
      },
    })
    expect(described.exitCodes).toEqual([
      { code: 0, meaning: 'ok' },
    ])
    expect(described.globalOptions).toEqual([
      { flags: '--json', description: 'json output' },
    ])
  })
})
