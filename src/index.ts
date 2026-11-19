/**
 * Public entry: configuration definition and public types.
 *
 * This entry must stay platform-neutral: it does not read files, touch
 * `process.env` or print anything, so Workers and browsers can import it.
 */
import { isLocalUrl } from './shared/index'

export interface DevkitIdentityConfig {
  /** CLI name; prefixes `command` in help output and JSON envelopes. */
  name: string
  /** Root command description. */
  description: string
  /** Next step shown in error hints. Defaults to `bun run <name>`. */
  helpHint?: string
  /** Implicit JSON switch, e.g. `YMMT_JSON`. */
  jsonEnvVar?: string
}

export interface DevkitEnvConfig {
  /** Environment file, relative to the repository root. */
  file: string
  /** Master switch variable name. Defaults to `LOCAL`. */
  localFlag?: string
  /** Remote-target suffix. Defaults to `_ONLINE`; empty string disables expansion. */
  onlineSuffix?: string
}

export interface DevkitDatabaseConfig {
  /** Database URL used when the local flag is on. */
  localUrl: string
  /** `/sql` proxy endpoint. */
  proxyEndpoint: string
  /** Drizzle migrations directory. */
  migrations: string
}

export interface DevkitStorageConfig {
  /** Local bucket name. */
  bucket?: string
  /** SILO data directory. Defaults to `temp/silo-data`. */
  dataDir?: string
  /** Env var that receives the derived public base when the local flag is on. */
  publicBaseEnv?: string
}

export interface DevkitPathsConfig {
  /** Log directory for background services. Defaults to `logs`. */
  logs?: string
}

export type DevkitServerRuntime = 'node' | 'bun'

export interface DevkitServerConfig {
  /** Process name, used as the log prefix. */
  name: string
  /** Runtime executable. Defaults to `node`. */
  runtime?: DevkitServerRuntime
  /** Executable, resolved from the repository root or `PATH`. */
  command: string
  /** Fixed arguments. */
  args?: string[]
}

export interface DevkitDevConfig {
  /** At least one dev server. */
  servers: DevkitServerConfig[]
}

export interface DevkitConfigInput {
  identity: DevkitIdentityConfig
  env: DevkitEnvConfig
  database: DevkitDatabaseConfig
  storage?: DevkitStorageConfig
  paths?: DevkitPathsConfig
  dev: DevkitDevConfig
}

export interface DevkitConfig {
  readonly identity: {
    readonly name: string
    readonly description: string
    readonly helpHint: string
    readonly jsonEnvVar?: string
  }
  readonly env: {
    readonly file: string
    readonly localFlag: string
    readonly onlineSuffix: string
  }
  readonly database: {
    readonly localUrl: string
    readonly proxyEndpoint: string
    readonly migrations: string
  }
  readonly storage: {
    readonly bucket?: string
    readonly dataDir: string
    readonly publicBaseEnv?: string
  }
  readonly paths: {
    readonly logs: string
  }
  readonly dev: {
    readonly servers: readonly {
      readonly name: string
      readonly runtime: DevkitServerRuntime
      readonly command: string
      readonly args: readonly string[]
    }[]
  }
}

/** Thrown for invalid configuration; `field` points at the exact location. */
export class DevkitConfigError extends Error {
  readonly code = 'INVALID_CONFIG'
  readonly field: string

  constructor(field: string, message: string) {
    super(`Invalid config ${field}: ${message}`)
    this.name = 'DevkitConfigError'
    this.field = field
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new DevkitConfigError(field, 'must be a non-empty string')
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined)
    return undefined
  return requireString(value, field)
}

function requireLocalUrl(value: unknown, field: string): string {
  const url = requireString(value, field)
  if (!isLocalUrl(url))
    throw new DevkitConfigError(field, `must point at localhost / 127.0.0.1 / [::1], received ${url}`)
  return url
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/**
 * Validate and freeze configuration. Pure computation only: no file reads,
 * no `process.env` writes, no output.
 *
 * The offending field is exposed as `DevkitConfigError.field`; the CLI maps
 * it to exit code 3.
 */
export function defineDevkit(input: DevkitConfigInput): DevkitConfig {
  const name = requireString(input.identity?.name, 'identity.name')
  const description = requireString(input.identity?.description, 'identity.description')
  const helpHint = optionalString(input.identity?.helpHint, 'identity.helpHint') ?? `bun run ${name}`
  const jsonEnvVar = optionalString(input.identity?.jsonEnvVar, 'identity.jsonEnvVar')

  const file = requireString(input.env?.file, 'env.file')
  const localFlag = optionalString(input.env?.localFlag, 'env.localFlag') ?? 'LOCAL'
  const onlineSuffix = input.env?.onlineSuffix ?? '_ONLINE'
  if (typeof onlineSuffix !== 'string')
    throw new DevkitConfigError('env.onlineSuffix', 'must be a string')

  const localUrl = requireLocalUrl(input.database?.localUrl, 'database.localUrl')
  const proxyEndpoint = requireLocalUrl(input.database?.proxyEndpoint, 'database.proxyEndpoint')
  const migrations = requireString(input.database?.migrations, 'database.migrations')

  const bucket = optionalString(input.storage?.bucket, 'storage.bucket')
  const dataDir = optionalString(input.storage?.dataDir, 'storage.dataDir') ?? 'temp/silo-data'
  const publicBaseEnv = optionalString(input.storage?.publicBaseEnv, 'storage.publicBaseEnv')

  const logs = optionalString(input.paths?.logs, 'paths.logs') ?? 'logs'

  if (!Array.isArray(input.dev?.servers) || input.dev.servers.length === 0)
    throw new DevkitConfigError('dev.servers', 'at least one dev server is required')

  const servers = input.dev.servers.map((server, index) => {
    const runtime = server.runtime ?? 'node'
    if (runtime !== 'node' && runtime !== 'bun')
      throw new DevkitConfigError(`dev.servers[${index}].runtime`, 'must be "node" or "bun"')
    if (!Array.isArray(server.args ?? []))
      throw new DevkitConfigError(`dev.servers[${index}].args`, 'must be an array of strings')
    return {
      name: requireString(server.name, `dev.servers[${index}].name`),
      runtime,
      command: requireString(server.command, `dev.servers[${index}].command`),
      args: (server.args ?? []).map((arg, argIndex) => {
        if (typeof arg !== 'string')
          throw new DevkitConfigError(`dev.servers[${index}].args[${argIndex}]`, 'must be a string')
        return arg
      }),
    }
  })

  return deepFreeze({
    identity: {
      name,
      description,
      helpHint,
      ...(jsonEnvVar
        ? { jsonEnvVar }
        : {}),
    },
    env: { file, localFlag, onlineSuffix },
    database: { localUrl, proxyEndpoint, migrations },
    storage: {
      ...(bucket
        ? { bucket }
        : {}),
      dataDir,
      ...(publicBaseEnv
        ? { publicBaseEnv }
        : {}),
    },
    paths: { logs },
    dev: { servers },
  })
}

export { isLocalMode, isLocalUrl, localPublicBase, parseEnvContent, upsertEnvValues } from './shared/index'
export type { LogLike } from './shared/index'
