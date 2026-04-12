import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'
import { app, setReady } from '../server/app'
import { listen } from '../server'
import { getStats } from '../server/stats'

// Start HTTP server immediately so the load balancer can probe /health (503 until ready).
// Warm-up runs in the background; setReady() flips /health to 200 when done.
listen(process.env.PORT ? parseInt(process.env.PORT) : 3000)
  .then(async () => {
    await db.migrate()
    await db.clearCache()
    log('cache cleared')
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
    startPeriodicRefresh(keys, manifests, 60_000)
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
    // Pre-warm stats cache so first request is instant
    getStats().then(() => log('stats cache warmed')).catch(() => {})
    setReady()
    log('server ready')
    // Wait for the server to close before running cleanup
    return new Promise<void>((resolve, reject) => {
      app.once('close', resolve).once('error', reject)
    })
  })
  .then(cleanup)
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
