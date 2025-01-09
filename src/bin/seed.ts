import { getDB } from '@/db'

async function main() {
  const db = getDB()
  try {
    await db.seed.run()
  } finally {
    await db.destroy()
  }
}

main().catch(console.error)
