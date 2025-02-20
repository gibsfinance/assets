import * as args from '@/args'
import { cleanup } from '@/cleanup'
import * as collect from '@/collect'
import * as db from '@/db'
import { seedOrders } from '@/db/create-orders'
const { providers } = args.collect()

db.getDB()
  .migrate.latest()
  .then(() => collect.main(providers()))
  .then(() => seedOrders())
  .catch((err) => console.log(err))
  .then(cleanup)
  .then(() => {
    console.log('finished')
    process.exit(0)
  })
