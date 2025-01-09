import { getDB } from '@/db'

async function main() {
  const db = getDB()
  try {
    await db.migrate.latest()
  } finally {
    await db.destroy()
  }
}

main()
