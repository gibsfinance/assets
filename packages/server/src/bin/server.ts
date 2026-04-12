import * as server from '../server'
import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'
import { setReady } from '../server/app'

// Start HTTP server immediately so the load balancer can probe /health (503 until ready)
server
  .listen()
  .then(async () => {
    // Run migrations + warm-up while returning 503 on /health
    await db.migrate()
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
    startPeriodicRefresh(keys, manifests, 60_000)
    // Daily variant prune job
    const pruneTimer = setInterval(
      async () => {
        try {
          const deleted = await db.pruneVariants()
          if (deleted > 0) {
            log('pruned %d image variants', deleted)
          }
        } catch (err) {
          log('variant prune failed: %o', err)
        }
      },
      24 * 60 * 60 * 1000,
    )
    pruneTimer.unref()
    // Flip health check to 200 — load balancer can start routing traffic
    setReady()
    log('server ready')
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .then(cleanup)
