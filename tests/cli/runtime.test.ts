import type { CommandSpec } from '../../src/cli'
import { Option } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCli, describeCli, runCli } from '../../src/cli'
import { UsageError } from '../../src/cli/exit'
import { createConfig } from '../testkit/config'

const config = createConfig()

function capture(): { out: string[], err: string[], restore: () => void } {
  const out: string[] = []
  const err: string[] = []
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk))
    return true
  })
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk))
    return true
  })
  return {
    out,
    err,
    restore: () => {
      outSpy.mockRestore()
      errSpy.mockRestore()
    },
  }
}

const demoSpec: CommandSpec = {
  id: 'demo.run',
  description: 'run the demo',
  options: [
    new Option('--name <name>', 'name'),
    new Option('--count <n>', 'count'),
    new Option('--verbose', 'verbose'),
  ],
  arguments: [
    { name: 'target', description: 'target' },
  ],
  async run(ctx) {
    const name = ctx.requireString('name')
    return {
      data: {
        name,
        count: ctx.integer('count', 1, 1),
        verbose: ctx.flag('verbose'),
        target: ctx.args[0],
        dryRun: ctx.dryRun,
        argv: ctx.toArgv(),
      },
    }
  },
}

const groups = [
  {
    name: 'demo',
    description: 'demo commands',
    commands: [demoSpec],
  },
]

beforeEach(() => {
  process.exitCode = undefined
  delete process.env.DEVKIT_TEST_JSON
})

afterEach(() => {
  process.exitCode = undefined
})

describe('describeCli', () => {
  it('describes the configured identity and exit codes', () => {
    const described = describeCli({ config, version: '1.2.3', groups })
    expect(described.name).toBe('devkit-test')
    expect(described.version).toBe('1.2.3')
    expect(described.exitCodes.map(code => code.code)).toEqual([0, 1, 2, 3])
    expect(described.groups[0]?.commands[0]?.id).toBe('demo.run')
    expect(described.groups[0]?.commands[0]?.arguments[0]).toEqual({
      name: 'target',
      description: 'target',
      required: true,
    })
  })
})

describe('buildCli', () => {
  it('uses the configured name and description', () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    expect(program.name()).toBe('devkit-test')
    expect(program.description()).toBe('devkit test project')
  })
})

describe('runCli', () => {
  it('exits 0 on --help', async () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, ['--help'])
    }
    finally {
      io.restore()
    }
    expect(process.exitCode).toBe(0)
    expect(io.out.join('')).toContain('Usage:')
  })

  it('exits 2 on an unknown command', async () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, ['nope'])
    }
    finally {
      io.restore()
    }
    expect(process.exitCode).toBe(2)
  })

  it('writes a single JSON envelope and keeps logs off stdout', async () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, [
        'demo',
        'run',
        'target',
        '--name',
        'value',
        '--count',
        '3',
        '--verbose',
        '--json',
      ])
    }
    finally {
      io.restore()
    }

    expect(process.exitCode).toBe(0)
    const lines = io.out.join('').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      ok: true,
      command: 'demo.run',
      data: {
        name: 'value',
        count: 3,
        verbose: true,
        target: 'target',
        argv: [
          'target',
          '--name',
          'value',
          '--count',
          '3',
          '--verbose',
        ],
      },
      error: null,
      meta: { mode: 'remote', dryRun: false, version: '1.2.3' },
    })
  })

  it('honors the implicit JSON env var', async () => {
    const implicit = createConfig({
      identity: { name: 'devkit-test', description: 'devkit test project', jsonEnvVar: 'DEVKIT_TEST_JSON' },
    })
    process.env.DEVKIT_TEST_JSON = '1'
    const program = buildCli({ config: implicit, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, [
        'demo',
        'run',
        'target',
        '--name',
        'value',
      ])
    }
    finally {
      io.restore()
    }
    expect(JSON.parse(io.out.join('').trim())).toMatchObject({ ok: true, command: 'demo.run' })
  })

  it('maps usage errors to exit code 2 inside the envelope', async () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, ['demo', 'run', 'target', '--json'])
    }
    finally {
      io.restore()
    }

    expect(process.exitCode).toBe(2)
    expect(JSON.parse(io.out.join('').trim())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('marks dry-run in the envelope meta', async () => {
    const program = buildCli({ config, version: '1.2.3', groups })
    const io = capture()
    try {
      await runCli(program, [
        'demo',
        'run',
        'target',
        '--name',
        'value',
        '--json',
        '--dry-run',
      ])
    }
    finally {
      io.restore()
    }
    expect(JSON.parse(io.out.join('').trim())).toMatchObject({
      data: { dryRun: true },
      meta: { dryRun: true },
    })
  })

  it('writes human errors to stderr, not stdout', async () => {
    const failing: CommandSpec = {
      id: 'demo.fail',
      description: 'fail',
      async run() {
        throw new UsageError('bad input', { hint: 'fix the input' })
      },
    }
    const program = buildCli({
      config,
      version: '1.2.3',
      groups: [
        {
          name: 'demo',
          description: 'demo',
          commands: [failing],
        },
      ],
    })
    const io = capture()
    try {
      await runCli(program, ['demo', 'fail'])
    }
    finally {
      io.restore()
    }

    expect(process.exitCode).toBe(2)
    expect(io.out.join('')).toBe('')
    expect(io.err.join('')).toContain('bad input')
    expect(io.err.join('')).toContain('Next: fix the input')
  })
})
