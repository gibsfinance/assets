import { getDrizzle } from '../db/drizzle'

async function main() {
  const _db = getDrizzle()
  console.log('Seed: Drizzle does not have a built-in seed runner. Use drizzle-kit or custom scripts.')
}

main().catch(console.error)
