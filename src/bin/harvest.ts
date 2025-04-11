import * as harvest from '@/harvest'
import * as db from '@/db'
import { cleanup } from '@/cleanup'
import { harvest as harvestArgs } from '@/args/harvest'
import { seedOrders } from '@/db/create-orders'
const arg = harvestArgs()

db.getDB()
  .migrate.latest()
  .then(() => harvest.main(arg))
  .then(() => seedOrders())
  .catch((err) => console.log(err))
  .then(cleanup)
  .then(() => {
    console.log('finished')
    process.exit(0)
  })
