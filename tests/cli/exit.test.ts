import { describe, expect, it } from 'vitest'
import { CliError, ConfigError, EXIT_CODES, requireEnvVar, UsageError } from '../../src/cli/exit'

describe('exit codes', () => {
  it('maps error types to the documented codes', () => {
    expect(new CliError('x').exitCode).toBe(EXIT_CODES.failure)
    expect(new UsageError('x').exitCode).toBe(EXIT_CODES.usage)
    expect(new ConfigError('x').exitCode).toBe(EXIT_CODES.config)
  })

  it('keeps stable error codes and context', () => {
    const error = new CliError('failed', {
      code: 'CUSTOM',
      hint: 'try again',
      context: { id: 1 },
      cause: new Error('root'),
    })
    expect(error.code).toBe('CUSTOM')
    expect(error.hint).toBe('try again')
    expect(error.context).toEqual({ id: 1 })
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe('requireEnvVar', () => {
  it('returns the value when set', () => {
    process.env.DEVKIT_TEST_ENV = 'value'
    expect(requireEnvVar('DEVKIT_TEST_ENV')).toBe('value')
    delete process.env.DEVKIT_TEST_ENV
  })

  it('throws a config error with a hint', () => {
    delete process.env.DEVKIT_TEST_ENV
    try {
      requireEnvVar('DEVKIT_TEST_ENV', 'set DEVKIT_TEST_ENV')
      expect.unreachable('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).hint).toBe('set DEVKIT_TEST_ENV')
      expect((error as ConfigError).exitCode).toBe(EXIT_CODES.config)
    }
  })
})
