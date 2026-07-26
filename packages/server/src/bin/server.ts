import * as db from '../db'
import { cleanup } from '../cleanup'
import { syncDefaultOrder, buildManifestsFromDB, startPeriodicRefresh } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { log } from '../logger'
import { app, setReady } from '../server/app'
import { listen } from '../server'
import { getStats } from '../server/stats'
import { warmTokensByChainCache, warmMergedCache, warmProviderListCache } from '../server/list/handlers'

// Start HTTP server immediately so the load balancer can probe /health (503 until ready).
// Warm-up runs in the background; setReady() flips /health to 200 when done.
listen(process.env.PORT ? parseInt(process.env.PORT) : 3000)
  .then(async () => {
    await db.migrate()
    // Only expired rows go. This used to delete every cached response on boot, to
    // guarantee a deploy never served a body built by older code — which it achieved by
    // destroying the layer that is expensive to rebuild while leaving the content
    // delivery network, the layer users actually reach, holding those same old bodies
    // for up to a day. Invalidation now runs the other way round: keys carry a shape
    // version (see RESPONSE_SHAPE_VERSION) so a change that alters a response retires
    // its keys deliberately, and the edge is purged below.
    const purged = await db.purgeExpiredCache()
    log('expired cache rows purged: %d', purged.rowCount ?? 0)
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
        await warmProviderListCache()
        log('provider list cache warmed for the largest lists')
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
    // Keep the warmed rows fresh rather than merely unexpired. The staleness threshold
    // inside each warmer is now the six-hour freshness window itself, so this interval
    // and that threshold are the same number and rows are rebuilt as they fall out of
    // freshness — they previously went stale at 6h but were not rebuilt until 12h, which
    // left every user in between served a stale body and paying for the background
    // revalidation the warmer was meant to have done already. Six hours also matches the
    // collection cron, so a tick lands against data that has actually changed; checking
    // hourly just re-ran the stats query eleven times per rebuild for nothing, its own
    // cache being a one-hour one.
    const warmTimer = setInterval(
      async () => {
        try {
          const stats = await getStats()
          await warmTokensByChainCache(stats)
          await warmMergedCache(stats)
          await warmProviderListCache()
          log('periodic warm complete')
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
