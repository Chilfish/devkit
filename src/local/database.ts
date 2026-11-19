import type { LogLike } from '../shared/index'
import { CliError } from '../cli/exit'
import { createLogger } from '../cli/logger'

const DATABASE_NAME_PATTERN = /^[a-z0-9_]+$/

/** Load an optional peer and turn a missing install into an actionable error. */
async function importPeer<T>(name: string, importer: () => Promise<T>): Promise<T> {
  try {
    return await importer()
  }
  catch (error) {
    throw new CliError(`Local database support requires the "${name}" package`, {
      code: 'MISSING_PEER',
      hint: 'bun add pg drizzle-orm',
      context: { package: name },
      cause: error,
    })
  }
}

/** Create the target database when it does not exist. Database names are whitelisted before interpolation. */
export async function ensureDatabase(
  databaseUrl: string,
  options: { log?: LogLike, dryRun?: boolean } = {},
): Promise<void> {
  const log = options.log ?? createLogger({ name: 'dev.db' })
  const database = new URL(databaseUrl).pathname.replace(/^\//, '')
  if (!DATABASE_NAME_PATTERN.test(database))
    throw new Error(`Invalid database name: ${database}`)

  if (options.dryRun) {
    log.info(`dry-run: would create database ${database} if missing`)
    return
  }

  const { Client } = await importPeer('pg', () => import('pg'))
  const admin = new URL(databaseUrl)
  admin.pathname = '/postgres'
  const client = new Client({
    connectionString: admin.toString(),
  })

  await client.connect()
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [database])
    if (!rowCount) {
      // Identifiers cannot be parameterized; `database` passed the whitelist above.
      await client.query(`create database "${database}"`)
      log.info(`created database ${database}`)
    }
  }
  finally {
    await client.end()
  }
}

/** Apply drizzle migrations from `migrationsFolder`. */
export async function applyMigrations(
  databaseUrl: string,
  migrationsFolder: string,
  options: { log?: LogLike, dryRun?: boolean } = {},
): Promise<void> {
  const log = options.log ?? createLogger({ name: 'dev.db' })
  if (options.dryRun) {
    log.info(`dry-run: would apply migrations from ${migrationsFolder}`)
    return
  }

  const [{ Pool }, { drizzle }, { migrate }] = await importPeer('pg + drizzle-orm', () => Promise.all([
    import('pg'),
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
  ]))

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder })
  }
  finally {
    await pool.end()
  }
}
