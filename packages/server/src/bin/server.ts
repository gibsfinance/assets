import * as server from '../server'
import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'

db.getDB()
  .migrate.latest()
  .then(async () => {
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
    startPeriodicRefresh(keys, manifests, 60_000)
    // Daily variant prune job
    const pruneTimer = setInterval(async () => {
      try {
        const deleted = await db.pruneVariants()
        if (deleted > 0) {
          log('pruned %d image variants', deleted)
        }
      } catch (err) {
        log('variant prune failed: %o', err)
      }
    }, 24 * 60 * 60 * 1000)
    pruneTimer.unref()
    return server.main()
  })
  .catch((err) => {
    console.error(err)
  })
  .then(cleanup)
