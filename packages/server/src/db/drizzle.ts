import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import configuration from '../../config'
import * as schema from './schema'

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

export { schema }
