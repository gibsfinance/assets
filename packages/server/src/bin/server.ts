import * as server from '../server'
import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'

db.getDB()
  .migrate.latest()
  .then(async () => {
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
    startPeriodicRefresh(keys, manifests, 60_000)
    return server.main()
  })
  .catch((err) => {
    console.error(err)
  })
  .then(cleanup)
