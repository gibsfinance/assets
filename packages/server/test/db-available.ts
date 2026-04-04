import { getDrizzle } from '../src/db/drizzle'
import { sql } from 'drizzle-orm'

let available: boolean | null = null

/** Returns true if the test database is reachable. Caches the result. */
export const isDbAvailable = async (): Promise<boolean> => {
  if (available !== null) return available
  try {
    await getDrizzle().execute(sql`SELECT 1`)
    available = true
  } catch {
    available = false
  }
  return available
}
