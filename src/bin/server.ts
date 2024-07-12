import * as server from '@/server'
import * as db from '@/db'
import { cleanup } from '@/cleanup'

db.getDB()
  .migrate.latest()
  .then(() => server.main())
  .catch((err) => {
    console.error(err)
  })
  .then(cleanup)
