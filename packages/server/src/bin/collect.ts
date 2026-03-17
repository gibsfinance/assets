import * as collect from '../collect'
import * as args from '../args'
import { cleanup } from '../cleanup'
import * as db from '../db'
import { seedOrders } from '../db/create-orders'
import { setDoesRender } from '../log/App'
const { providers, logger } = args.collect()

setDoesRender(logger === 'terminal')

async function runCollect() {
  try {
    const dbInstance = db.getDB()
    await dbInstance.migrate.latest()
    await db.purgeExpiredCache().catch(() => {})
    await collect.main(providers(), logger)
    // await seedOrders() // TODO: Investigate seedOrders hanging
  } catch (err) {
    console.error('Collection failed:', err)
  } finally {
    await cleanup()
  }
}

runCollect()
