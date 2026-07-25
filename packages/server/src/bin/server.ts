import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'
import { app, setReady } from '../server/app'
import { listen } from '../server'
import { getStats } from '../server/stats'
import { warmTokensByChainCache, warmMergedCache } from '../server/list/handlers'

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
    // Warmup runs in the background. /health stays 503 until it completes so the
    // load balancer doesn't route traffic until tokensByChain is cached. A hung
    // warm query must not hold /health at 503 forever, so readiness is bounded:
    // setReady() flips by the deadline even if the warm is still running, and the
    // warm continues in the background.
    const readinessDeadlineMs = 120_000
    const warmup = getStats()
      .then(async (stats) => {
        log('stats cache warmed')
        // Sequential, not concurrent: each warm runs the same ranked query, which sorts
        // well over a million list entries for Ethereum alone, and overlapping them
        // multiplies the load on the database at exactly the moment the server is still
        // proving itself ready.
        await warmTokensByChainCache(stats)
        log('tokensByChain cache warmed for top chains')
        await warmMergedCache(stats)
        log('merged cache warmed for top chains')
      })
      .catch((err: unknown) => log('warmup failed: %o', err))
    let readinessTimer: NodeJS.Timeout | undefined
    const deadline = new Promise<'timeout'>((resolve) => {
      readinessTimer = setTimeout(() => resolve('timeout'), readinessDeadlineMs)
      readinessTimer.unref()
    })
    Promise.race([warmup, deadline]).then((outcome) => {
      clearTimeout(readinessTimer)
      if (outcome === 'timeout') {
        log(
          'readiness deadline (%dms) reached before warmup completed; warmup continues in background',
          readinessDeadlineMs,
        )
      }
      setReady()
      log('server ready')
    })
    // Keep the top-N chain caches warm — 12h staleness threshold inside, for both the
    // tokensByChain and merged bodies. Without this, a quiet 24h on any top chain drops
    // the row from cache and the next user pays the full cold-build cost (~19s for
    // Ethereum on merged, measured against production). The 6h interval is half the staleness
    // threshold: rows go stale at 12h, get rebuilt within 6h of that, and never reach
    // the 24h hard expiry — checking hourly just re-ran the stats query 11 times per
    // rebuild for nothing (its cache TTL is 1h, so every tick recomputed it).
    const warmTimer = setInterval(
      async () => {
        try {
          const stats = await getStats()
          await warmTokensByChainCache(stats)
          await warmMergedCache(stats)
          log('periodic tokensByChain and merged warm complete')
        } catch (err) {
          log('periodic warm failed: %o', err)
        }
      },
      6 * 60 * 60 * 1000,
    )
    warmTimer.unref()
    // Wait for the server to close before running cleanup
    return new Promise<void>((resolve, reject) => {
      app.once('close', resolve).once('error', reject)
    })
  })
  .then(cleanup)
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
