import { getDB } from '@/db'

async function main() {
  const db = getDB()
  await db.migrate.latest()
}

main()
