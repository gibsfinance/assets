import promiseLimit from 'promise-limit'
import * as utils from '../utils'
import { type Collectable, collectables } from '../collect/collectables'
import { loadSubmissionCollectors, updateSubmissionStatus } from './user-submissions'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '../log/types'
import { failureLog } from '@gibs/utils'
import { forceRerender } from '../log/App'
import { getDB } from '../db'
import type { DiscoveryManifest } from './base-collector'
import { syncDefaultOrder, startPeriodicRefresh } from '../db/sync-order'

const DEFAULT_PROVIDER_CONCURRENCY = 4

const checkOutstandingConnections = async (provider: string) => {
  const db = getDB()
  const pool = db.client.pool
  const used = pool.numUsed()
  const pending = pool.numPendingAcquires()
  const free = pool.numFree()
  const active = await db.raw(
    `SELECT pid, state, left(query, 80) as query, now() - xact_start as xact_duration
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid != pg_backend_pid()
       AND state != 'idle'`,
  )
  const activeRows = active.rows as { pid: number; state: string; query: string; xact_duration: string }[]
  if (used > 0 || pending > 0 || activeRows.length > 0) {
    failureLog(
      'outstanding after %s: pool(used=%d free=%d pending=%d) pg_active=%d',
      provider,
      used,
      free,
      pending,
      activeRows.length,
    )
    for (const row of activeRows) {
      failureLog('  pid=%d state=%s duration=%s query=%s', row.pid, row.state, row.xact_duration, row.query)
    }
  }
}

/**
 * Main collection function that orchestrates two-phase data collection:
 *   Phase 1 (discover): register providers + lists, collect manifests
 *   Order sync: persist default ordering from manifest data
 *   Phase 2 (collect): process tokens + images
 */
export const main = async (
  providers: Collectable[],
  logger = 'terminal',
  concurrency = DEFAULT_PROVIDER_CONCURRENCY,
) => {
  const c = collectables()

  // Merge in user-submitted list collectors
  try {
    const submissionCollectors = await loadSubmissionCollectors()
    for (const [key, collector] of Object.entries(submissionCollectors)) {
      if (!(key in c)) {
        ;(c as Record<string, typeof collector>)[key] = collector
        ;(providers as string[]).push(key)
      }
    }
  } catch (err) {
    failureLog('Failed to load submission collectors:', err)
  }

  const manifests = new Map<string, DiscoveryManifest>()

  if (logger === 'raw') {
    await rawTwoPhase(providers, c, manifests)
  } else {
    await terminalTwoPhase(providers, c, manifests, concurrency)
  }
}

/**
 * Two-phase orchestration with raw console logging (sequential, for debugging)
 */
const rawTwoPhase = async (
  providers: Collectable[],
  c: ReturnType<typeof collectables>,
  manifests: Map<string, DiscoveryManifest>,
) => {
  // Phase 1: discover
  console.log(`Starting discovery for providers: ${providers.join(', ')}`)
  for (const provider of providers) {
    if (utils.controller.signal.aborted) {
      console.log(`Aborted, skipping discover for ${provider}`)
      continue
    }
    const collector = c[provider]
    if (!collector) {
      console.log(`No collector found for ${provider}, skipping`)
      continue
    }
    console.log(`Discovering ${provider}...`)
    const startTime = Date.now()
    try {
      const manifest = await collector.discover(utils.controller.signal)
      manifests.set(provider, manifest)
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`Discovered ${provider} in ${duration}s (${manifest.length} entries)`)
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      console.error(`Discovery failed for ${provider} after ${duration}s:`, err)
      failureLog('discover error %o %o', provider, err)
    }
  }

  // Order sync
  console.log('\nSyncing default order...')
  try {
    await syncDefaultOrder(providers, manifests)
    console.log('Default order synced')
  } catch (err) {
    console.error('Failed to sync default order:', err)
  }
  const stopRefresh = startPeriodicRefresh(providers, manifests)

  // Phase 2: collect
  console.log(`\nStarting collection for providers: ${providers.join(', ')}`)
  for (const provider of providers) {
    console.log(`\n=== Processing provider: ${provider} ===`)
    if (utils.controller.signal.aborted) {
      console.log(`Aborted, skipping ${provider}`)
      continue
    }
    const collector = c[provider]
    if (!collector) {
      console.log(`No collector found for ${provider}, skipping`)
      continue
    }
    console.log(`Starting collector for ${provider}`)
    const startTime = Date.now()
    try {
      await collector.collect(utils.controller.signal)
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`Collector ${provider} completed successfully in ${duration}s`)
      if (provider.startsWith('user-')) {
        await updateSubmissionStatus(provider, { success: true })
      }
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)
      console.error(`Collector ${provider} failed after ${duration}s:`, err)
      failureLog('error %o %o', provider, err)
      failureLog('failed to collect', provider, (err as Error).message)
      if (provider.startsWith('user-')) {
        await updateSubmissionStatus(provider, { success: false })
      }
    }
    await checkOutstandingConnections(provider)
  }

  // Final sync + cleanup
  try {
    await syncDefaultOrder(providers, manifests)
  } catch (err) {
    console.error('Final order sync failed:', err)
  }
  stopRefresh()
  console.log('\nAll providers completed!')
}

/**
 * Two-phase orchestration with terminal UI logging (concurrent)
 */
const terminalTwoPhase = async (
  providers: Collectable[],
  c: ReturnType<typeof collectables>,
  manifests: Map<string, DiscoveryManifest>,
  concurrency: number,
) => {
  const limit = promiseLimit<Collectable>(concurrency)
  utils.terminalRow.update({
    id: 'collect',
    type: terminalRowTypes.SUMMARY,
  })
  utils.terminalRow.createCounter(terminalCounterTypes.PROVIDER)
  utils.terminalRow.incrementTotal(terminalCounterTypes.PROVIDER, new Set(providers))

  // Phase 1: discover (concurrent)
  await limit.map(providers, async (provider) => {
    if (utils.controller.signal.aborted) return
    const collector = c[provider]
    if (!collector) return

    try {
      const manifest = await collector.discover(utils.controller.signal)
      manifests.set(provider, manifest)
    } catch (err) {
      failureLog('discover error %o %o', provider, err)
    }
  })

  // Order sync
  try {
    await syncDefaultOrder(providers, manifests)
  } catch (err) {
    failureLog('order sync error %o', err)
  }
  const stopRefresh = startPeriodicRefresh(providers, manifests)

  // Phase 2: collect (concurrent)
  await limit.map(providers, async (provider) => {
    if (utils.controller.signal.aborted) return
    const collector = c[provider]
    if (!collector) {
      utils.terminalRow.increment('skipped', provider)
    } else {
      utils.terminalRow.increment('running', provider)
      try {
        await collector.collect(utils.controller.signal)
        utils.terminalRow.increment('success', provider)
        if (provider.startsWith('user-')) {
          await updateSubmissionStatus(provider, { success: true })
        }
      } catch (err) {
        failureLog('error %o %o', provider, err)
        utils.terminalRow.increment(terminalLogTypes.EROR, provider)
        failureLog('failed to collect', provider, (err as Error).message)
        if (provider.startsWith('user-')) {
          await updateSubmissionStatus(provider, { success: false })
        }
      }
      if (concurrency === 1) {
        await checkOutstandingConnections(provider)
      }
      utils.terminalRow.decrement('running', provider)
    }
    utils.terminalRow.increment(terminalCounterTypes.PROVIDER, provider)
  })

  // Final sync + cleanup
  try {
    await syncDefaultOrder(providers, manifests)
  } catch (err) {
    failureLog('final order sync error %o', err)
  }
  stopRefresh()

  utils.terminalRow.complete()
  forceRerender()
}
