import * as collect from '@/collect'
import * as db from '@/db'
import { cleanup } from '@/cleanup'
import * as args from '@/args'

const { providers } = args.collect()

db.getDB().migrate.latest()
  .then(() => collect.main(providers))
  .catch((err) => console.log(err))
  .then(cleanup)
  .then(() => {
    console.log('finished')
    process.exit(0)
  })
