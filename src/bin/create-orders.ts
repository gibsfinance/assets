// import { migrate } from '@/bin/migrate'
import { getDB } from '@/db'
import { seedOrders } from '@/db/create-orders'
import { cleanup } from '@/cleanup'

getDB()
  .migrate.latest()
  .then(() => seedOrders())
  .catch((err: unknown) => {
    console.error(err)
  })
  .then(cleanup)
