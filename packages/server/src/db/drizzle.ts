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

/** Run pending Drizzle migrations from the drizzle/ directory. */
export async function migrate(): Promise<void> {
  await drizzleMigrate(db, {
    migrationsFolder: path.join(__dirname, '..', '..', 'drizzle'),
  })
}

export { schema }
