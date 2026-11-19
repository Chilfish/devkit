import type { DevkitConfig } from '../index'
import type { CommandResult, EnvelopeError } from './envelope'
import type { Logger, LogLevel } from './logger'
import { Command, CommanderError, Help, Option } from 'commander'
import { describeEnvironment, loadEnvFile } from '../env/index'
import { isLocalMode } from '../shared/index'
import { buildEnvelope, serializeEnvelope } from './envelope'
import { CliError, EXIT_CODES, UsageError } from './exit'
import { createLogger } from './logger'

/** commander ships English help titles; replace them with a consistent set. */
const HELP_TITLES: Record<string, string> = {
  'Usage:': 'Usage:',
  'Options:': 'Options:',
  'Global Options:': 'Global options:',
  'Commands:': 'Commands:',
  'Arguments:': 'Arguments:',
}

/** Localize the few commander-generated phrases that appear inside help bodies. */
function localizeHelpText(text: string): string {
  return text
    .replace(/display help for command/g, 'show help for a command')
    .replace(/\((choices|default): ([^()]*)\)/g, (_match, label: string, value: string) => (
      `(${label === 'choices'
        ? 'choices'
        : 'default'}: ${value})`
    ))
}

class LocalizedHelp extends Help {
  override styleTitle(text: string): string {
    return super.styleTitle(HELP_TITLES[text] ?? text)
  }

  override formatHelp(cmd: Command, helper: Help): string {
    return localizeHelpText(super.formatHelp(cmd, helper))
  }
}

/** Help and global options must be attached to every command level: commander does not inherit them. */
function applySharedSettings(command: Command): void {
  command.createHelp = (): Help => new LocalizedHelp()
  command.helpOption('-h, --help', 'show help')
  addGlobalOptions(command)
  command.exitOverride()
  command.configureOutput({
    writeOut: text => process.stdout.write(text),
    writeErr: text => process.stderr.write(text),
  })
  const originalHelp = command.helpInformation.bind(command)
  command.helpInformation = (context?: unknown): string => {
    for (const child of command.commands) {
      if (child.name() === 'help')
        child.description('show help for a command')
    }
    return originalHelp(context as Parameters<typeof originalHelp>[0])
  }
}

/** Static description of a command; the runtime builds commander subcommands and `describe` output from it. */
export interface CommandSpec<T = unknown> {
  /** Stable id, e.g. `dev.db`; used in envelopes and log prefixes. */
  id: string
  /** One-line description, verb first. */
  description: string
  /** Longer text for `--help`. */
  details?: string
  /** Usage examples. */
  examples?: string[]
  /** Command-specific options; global options are injected by the runtime. */
  options?: Option[]
  /** Positional arguments. */
  arguments?: { name: string, description: string, required?: boolean }[]
  /** Implementation. In dry-run mode the runtime sets `ctx.dryRun`; the command must stay read-only. */
  run: (ctx: CommandContext) => Promise<CommandResult<T> | void>
}

export interface CommandContext {
  /** Parsed command options, excluding global options. */
  options: Record<string, unknown>
  /** Positional arguments, in `spec.arguments` order. */
  args: string[]
  /** Logger prefixed with the command id. */
  log: Logger
  /** Dry-run: no database writes, object-storage writes or local file writes. */
  dryRun: boolean
  /** JSON output mode. */
  json: boolean
  /** Read a required string option; throws UsageError when missing or empty. */
  requireString: (name: string) => string
  /** Read an integer option with a lower bound. */
  integer: (name: string, fallback: number, min?: number) => number
  /** Read a boolean option. */
  flag: (name: string) => boolean
  /** Rebuild CLI arguments from parsed options. */
  toArgv: (options?: { includeDryRun?: boolean }) => string[]
}

export interface CommandGroup {
  /** Top-level group name, e.g. `dev`. */
  name: string
  description: string
  commands: CommandSpec[]
}

export interface BuildCliOptions {
  config: DevkitConfig
  version: string
  groups?: CommandGroup[]
  rootCommands?: CommandSpec[]
  /** Override describe labels so hosts can keep their existing language. */
  labels?: CliLabels
}

type RuntimeFlag = 'json' | 'quiet' | 'dryRun' | 'logLevel' | 'logFile'

const GLOBAL_OPTION_KEYS = new Set<RuntimeFlag>([
  'json',
  'quiet',
  'dryRun',
  'logLevel',
  'logFile',
])

interface GlobalValues {
  json: boolean
  quiet: boolean
  dryRun: boolean
  logLevel: LogLevel
  logFile?: string
}

function readGlobal(command: Command, config: DevkitConfig): GlobalValues {
  const options = command.optsWithGlobals() as Record<string, unknown>
  const level = options.logLevel
  if (level !== undefined && level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
    throw new UsageError(`--log-level must be debug / info / warn / error, received ${String(level)}`, {
      context: { option: 'logLevel', value: level },
    })
  }
  const envJson = config.identity.jsonEnvVar
    ? process.env[config.identity.jsonEnvVar] === '1'
    : false
  return {
    json: options.json === true || envJson,
    quiet: options.quiet === true,
    dryRun: options.dryRun === true,
    logLevel: (level ?? 'info') as LogLevel,
    logFile: typeof options.logFile === 'string'
      ? options.logFile
      : undefined,
  }
}

function addGlobalOptions(command: Command): Command {
  return command
    .addOption(new Option('--json', 'write a single-line JSON envelope ({ok,command,data,error,meta}) to stdout'))
    .addOption(new Option('--quiet', 'keep only warnings and errors'))
    .addOption(new Option('--dry-run', 'read-only: no database, object-storage or local file writes'))
    .addOption(new Option('--log-level <level>', 'log level: debug / info / warn / error (default info)'))
    .addOption(new Option('--log-file <path>', 'append logs to a file as NDJSON'))
}

/** Remaining options after dropping global ones, passed to `run` as command options. */
function commandOptions(command: Command): Record<string, unknown> {
  const raw = command.opts() as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (GLOBAL_OPTION_KEYS.has(key as RuntimeFlag))
      continue
    result[key] = value
  }
  return result
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

function createContext(
  config: DevkitConfig,
  spec: CommandSpec,
  command: Command,
  globals: GlobalValues,
): CommandContext {
  const options = commandOptions(command)
  const log = createLogger({
    name: spec.id,
    level: globals.logLevel,
    quiet: globals.quiet,
    file: globals.logFile,
    silentOutput: globals.json,
  })

  return {
    options,
    args: command.args.slice(),
    log,
    dryRun: globals.dryRun,
    json: globals.json,
    requireString(name) {
      const value = options[name]
      if (typeof value !== 'string' || value.length === 0) {
        throw new UsageError(`Missing --${kebab(name)}`, {
          hint: `See ${config.identity.helpHint} ${spec.id.replaceAll('.', ' ')} --help`,
          context: { option: name },
        })
      }
      return value
    },
    integer(name, fallback, min = 0) {
      const raw = options[name]
      if (raw === undefined)
        return fallback
      const value = Number(raw)
      if (!Number.isInteger(value) || value < min) {
        throw new UsageError(`--${kebab(name)} must be an integer >= ${min}`, {
          context: { option: name, value: raw },
        })
      }
      return value
    },
    flag(name) {
      return options[name] === true
    },
    toArgv(argvOptions) {
      const argv: string[] = [...this.args]
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined || value === false || value === null)
          continue
        const flag = `--${kebab(key)}`
        if (value === true) {
          argv.push(flag)
        }
        else if (Array.isArray(value)) {
          for (const item of value) argv.push(flag, String(item))
        }
        else {
          argv.push(flag, String(value))
        }
      }
      if (argvOptions?.includeDryRun && globals.dryRun)
        argv.push('--dry-run')
      return argv
    },
  }
}

function toEnvelopeError(error: unknown): { payload: EnvelopeError, exitCode: number } {
  if (error instanceof CliError) {
    return {
      payload: {
        code: error.code,
        message: error.message,
        ...(error.hint
          ? { hint: error.hint }
          : {}),
        ...(error.context
          ? { context: error.context }
          : {}),
      },
      exitCode: error.exitCode,
    }
  }
  const message = error instanceof Error
    ? error.message
    : String(error)
  return {
    payload: { code: 'FAILED', message },
    exitCode: EXIT_CODES.failure,
  }
}

function buildMeta(config: DevkitConfig, globals: GlobalValues, version: string, startTime: number): {
  mode: 'local' | 'remote'
  durationMs: number
  dryRun: boolean
  version: string
} {
  return {
    mode: isLocalMode(process.env, config.env.localFlag)
      ? 'local'
      : 'remote',
    durationMs: Date.now() - startTime,
    dryRun: globals.dryRun,
    version,
  }
}

/**
 * In `--json` mode stdout may contain exactly one envelope line.
 * Route console logging to stderr while the command runs so `| jq` always parses.
 */
function redirectConsoleToStderr(): () => void {
  const saved = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    table: console.table,
  }
  const toErr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map(item => (typeof item === 'string'
      ? item
      : JSON.stringify(item))).join(' ')}\n`)
  }
  console.log = toErr
  console.info = toErr
  console.debug = toErr
  console.table = toErr
  return () => Object.assign(console, saved)
}

/** Thrown when a command body calls `process.exit(code)`; the runtime maps it to an exit code. */
class CommandExit extends Error {
  readonly code: number
  constructor(code: number) {
    super(`Command exited with code ${code}`)
    this.name = 'CommandExit'
    this.code = code
  }
}

/**
 * Take over `process.exit` while a command runs.
 *
 * Migrated command bodies still call `process.exit(1)`; killing the process
 * directly would skip the JSON envelope and console restoration.
 */
function interceptProcessExit(): () => void {
  const original = process.exit.bind(process)
  process.exit = ((code?: number) => {
    throw new CommandExit(typeof code === 'number'
      ? code
      : EXIT_CODES.ok)
  }) as typeof process.exit
  return () => {
    process.exit = original
  }
}

/** Wrap a command with the shared runner: environment banner, envelope, exit code. */
function attachRunner(
  command: Command,
  spec: CommandSpec,
  config: DevkitConfig,
  version: string,
  startTime: number,
): Command {
  command.action(async (...actionArgs: unknown[]) => {
    const self = actionArgs[actionArgs.length - 1] as Command
    let globals: GlobalValues
    let ctx: CommandContext
    try {
      globals = readGlobal(self, config)
      ctx = createContext(config, spec, self, globals)
    }
    catch (error) {
      const { payload, exitCode } = toEnvelopeError(error)
      process.stderr.write(`${payload.message}\n`)
      if (payload.hint)
        process.stderr.write(`Next: ${payload.hint}\n`)
      process.exitCode = exitCode
      return
    }

    loadEnvFile({ config, log: false })
    if (!globals.json)
      ctx.log.info(describeEnvironment(process.env, config))

    const restoreConsole = globals.json
      ? redirectConsoleToStderr()
      : null
    const restoreExit = interceptProcessExit()
    try {
      const result = (await spec.run(ctx)) ?? {}
      const ok = (result.exitCode ?? EXIT_CODES.ok) === 0
      if (globals.json) {
        process.stdout.write(`${serializeEnvelope(buildEnvelope({
          command: spec.id,
          ok,
          data: result.data,
          meta: buildMeta(config, globals, version, startTime),
        }))}\n`)
      }
      else if (result.summary) {
        ctx.log.line(result.summary)
      }
      process.exitCode = result.exitCode ?? EXIT_CODES.ok
    }
    catch (error) {
      if (error instanceof CommandExit) {
        if (globals.json) {
          process.stdout.write(`${serializeEnvelope(buildEnvelope({
            command: spec.id,
            ok: error.code === 0,
            ...(error.code === 0
              ? {}
              : {
                  error: { code: 'EXITED', message: 'Command exited with a non-zero code' },
                }),
            meta: buildMeta(config, globals, version, startTime),
          }))}\n`)
        }
        process.exitCode = error.code
        return
      }

      const { payload, exitCode } = toEnvelopeError(error)
      if (globals.json) {
        process.stdout.write(`${serializeEnvelope(buildEnvelope({
          command: spec.id,
          ok: false,
          error: payload,
          meta: buildMeta(config, globals, version, startTime),
        }))}\n`)
      }
      else {
        ctx.log.error(payload.message)
        if (payload.hint)
          ctx.log.line(`Next: ${payload.hint}`)
        if (globals.logLevel === 'debug' && error instanceof Error && error.stack) {
          ctx.log.debug(error.stack)
        }
      }
      process.exitCode = exitCode
    }
    finally {
      restoreExit()
      restoreConsole?.()
    }
  })
  return command
}

/** Build a commander subcommand from a spec and attach it to `parent`. */
export function registerCommand(
  parent: Command,
  spec: CommandSpec,
  config: DevkitConfig,
  version: string,
): Command {
  const startTime = Date.now()
  const name = spec.id.split('.').at(-1) ?? spec.id
  const command = parent.command(name).description(spec.description)
  applySharedSettings(command)
  const helpExtras: string[] = []
  if (spec.details)
    helpExtras.push(spec.details)
  if (spec.examples && spec.examples.length > 0) {
    helpExtras.push(`Examples:\n${spec.examples.map(line => `  ${line}`).join('\n')}`)
  }
  if (helpExtras.length > 0)
    command.addHelpText('after', `\n${helpExtras.join('\n\n')}`)
  for (const option of spec.options ?? []) command.addOption(option)
  for (const argument of spec.arguments ?? []) {
    if (argument.required === false)
      command.argument(`[${argument.name}]`, argument.description)
    else command.argument(`<${argument.name}>`, argument.description)
  }
  return attachRunner(command, spec, config, version, startTime)
}

export interface DescribeCommand {
  id: string
  description: string
  details?: string
  examples?: string[]
  options: { flags: string, description: string, default?: unknown, choices?: string[] }[]
  arguments: { name: string, description: string, required: boolean }[]
}

export interface CliDescription {
  name: string
  version: string
  exitCodes: { code: number, meaning: string }[]
  globalOptions: { flags: string, description: string }[]
  commands: DescribeCommand[]
  groups: { name: string, description: string, commands: DescribeCommand[] }[]
}

/** Labels exposed by `describe`; override them to preserve an existing contract. */
export interface CliLabels {
  exitCodes?: { code: number, meaning: string }[]
  globalOptions?: { flags: string, description: string }[]
}

/** Structured command-tree description shared by the `describe` command and doc generation. */
export function describeCli(options: BuildCliOptions): CliDescription {
  const toDescribed = (spec: CommandSpec): DescribeCommand => ({
    id: spec.id,
    description: spec.description,
    ...(spec.details
      ? { details: spec.details }
      : {}),
    ...(spec.examples
      ? { examples: spec.examples }
      : {}),
    options: (spec.options ?? []).map(option => ({
      flags: option.flags,
      description: option.description,
      ...(option.defaultValue !== undefined
        ? { default: option.defaultValue }
        : {}),
      ...(option.argChoices
        ? { choices: option.argChoices }
        : {}),
    })),
    arguments: (spec.arguments ?? []).map(argument => ({
      name: argument.name,
      description: argument.description,
      required: argument.required !== false,
    })),
  })

  return {
    name: options.config.identity.name,
    version: options.version,
    exitCodes: options.labels?.exitCodes ?? [
      { code: 0, meaning: 'success / already converged' },
      { code: 1, meaning: 'runtime failure (partial batch failure included)' },
      { code: 2, meaning: 'usage error: unknown flag, missing required value, invalid value' },
      { code: 3, meaning: 'missing configuration: env var or config file not set' },
    ],
    globalOptions: options.labels?.globalOptions ?? [
      { flags: '--json', description: 'write a single-line JSON envelope to stdout' },
      { flags: '--quiet', description: 'keep only warnings and errors' },
      { flags: '--dry-run', description: 'read-only: no database, object-storage or local file writes' },
      { flags: '--log-level <level>', description: 'debug / info / warn / error (default info)' },
      { flags: '--log-file <path>', description: 'append logs to a file as NDJSON' },
      { flags: '-h, --help', description: 'show help' },
      { flags: '-V, --version', description: 'show version' },
    ],
    commands: (options.rootCommands ?? []).map(toDescribed),
    groups: (options.groups ?? []).map(group => ({
      name: group.name,
      description: group.description,
      commands: group.commands.map(toDescribed),
    })),
  }
}

/** Build the whole CLI tree. */
export function buildCli(options: BuildCliOptions): Command {
  const { config, version } = options
  const groups = options.groups ?? []
  const rootCommands = options.rootCommands ?? []

  const program = new Command()
  program
    .name(config.identity.name)
    .description(config.identity.description)
    .version(version, '-V, --version', 'show version')
    .showHelpAfterError('(run with --help for full usage)')
  applySharedSettings(program)
  program.enablePositionalOptions()

  const describeCommand = program
    .command('describe')
    .description('print the full command tree as JSON so agents can bootstrap without reading source')
  applySharedSettings(describeCommand)
  describeCommand.action(() => {
    process.stdout.write(`${JSON.stringify(describeCli(options), null, 2)}\n`)
  })

  for (const group of groups) {
    const groupCommand = program.command(group.name).description(group.description)
    applySharedSettings(groupCommand)
    for (const spec of group.commands) registerCommand(groupCommand, spec, config, version)
  }

  for (const spec of rootCommands) registerCommand(program, spec, config, version)

  return program
}

/**
 * Run the CLI and normalize commander's own errors (`--help`, `--version`, bad arguments).
 *
 * commander would call `process.exit` by default; here:
 * - `--help` / `--version`: exit 0;
 * - unknown command / unknown option / missing argument: exit 2, hint on stderr.
 */
export async function runCli(program: Command, argv: string[]): Promise<void> {
  program.commands.forEach((command) => {
    if (command.name() === 'help')
      command.description('show help for a command')
  })
  try {
    await program.parseAsync(argv, { from: 'user' })
  }
  catch (error) {
    if (error instanceof CommanderError) {
      const helpCodes = new Set(['commander.helpDisplayed', 'commander.help', 'commander.version'])
      if (helpCodes.has(error.code)) {
        process.exitCode = EXIT_CODES.ok
        return
      }
      process.exitCode = EXIT_CODES.usage
      return
    }
    throw error
  }
}
