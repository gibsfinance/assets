import { migrate } from '../db/drizzle'

async function main() {
  try {
    await migrate()
    console.log('Migrations complete')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  }
}

main()
