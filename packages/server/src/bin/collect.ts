import * as collect from '../collect'
import * as args from '../args'
import { cleanup } from '../cleanup'
import * as db from '../db'
import { seedOrders } from '../db/create-orders'
import { setDoesRender } from '../log/App'
const { providers, logger } = args.collect()

setDoesRender(logger === 'terminal')

db.getDB()
  .migrate.latest()
  .then(() => collect.main(providers()))
  .then(() => seedOrders())
  .catch((err) => console.log(err))
  .then(cleanup)
