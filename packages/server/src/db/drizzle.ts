import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import * as path from 'path'
import { fileURLToPath } from 'url'
import configuration from '../../config'
import * as schema from './schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export type DrizzleDB = NodePgDatabase<typeof schema>
export type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0]

const db: DrizzleDB = drizzle({
  connection: {
    connectionString: configuration.database.url,
    ssl: configuration.database.ssl ? { rejectUnauthorized: false } : false,
  },
  schema,
  casing: 'snake_case',
})

export function getDrizzle(): DrizzleDB {
  return db
}

export async function closeDb(): Promise<void> {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end()
}

/**
 * The Postgres advisory lock key that serialises migrations. Any constant works, as
 * long as every process that migrates this database uses the same one.
 */
export const MIGRATION_LOCK_KEY = 4_716_150_011

/** The slice of a pooled `pg` client that migrate() needs. */
type LockClient = {
  query(text: string, values: unknown[]): Promise<unknown>
  /** `pg`'s own signature: a truthy argument destroys the connection instead of pooling it. */
  release(destroy?: boolean): void
}

/**
 * Run pending Drizzle migrations from the drizzle/ directory.
 *
 * The server and the collector both migrate when they start, and Drizzle's migrator
 * takes no lock of its own. On an empty database two processes raced each other: both
 * ran `CREATE EXTENSION IF NOT EXISTS citext` and the loser failed on the unique index
 * of `pg_extension`. Holding a session-level advisory lock for the whole run makes the
 * second process wait, then find nothing left to apply.
 */
export async function migrate(): Promise<void> {
  const pool = (db as unknown as { $client: { connect(): Promise<LockClient> } }).$client
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await drizzleMigrate(db, {
      migrationsFolder: path.join(__dirname, '..', '..', 'drizzle'),
    })
  } finally {
    // An advisory lock lives as long as its session. If the unlock fails, hand the
    // connection back as broken so the pool closes it; closing the session frees the
    // lock. Returning it healthy would park the lock in the pool for good.
    const unlocked = await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).then(
      () => true,
      () => false,
    )
    lockClient.release(!unlocked)
  }
}

export { schema }
