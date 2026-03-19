import type { DiscoveryManifest } from '../collect/base-collector'
import type { BackfillableInsertableListOrderItem } from 'knex/types/tables'
import * as db from '.'
import * as viem from 'viem'
import { tableNames } from './tables'

const RANKING_SPACING = 1000n

type RankingEntry = {
  providerKey: string
  listKey: string
  ranking: number
}

/**
 * Pure function: compute ranking entries from collectable key order and manifests.
 * No DB interaction — suitable for unit testing.
 */
export const computeRankings = (
  collectableKeys: string[],
  manifests: Map<string, DiscoveryManifest>,
): RankingEntry[] => {
  const rankings: RankingEntry[] = []

  for (const [position, key] of collectableKeys.entries()) {
    const manifest = manifests.get(key)
    if (!manifest?.length) continue

    const base = BigInt(position) * RANKING_SPACING

    // Flatten all provider+list pairs, sort alphabetically for determinism
    const pairs: Array<{ providerKey: string; listKey: string }> = []
    for (const entry of manifest) {
      for (const list of entry.lists) {
        pairs.push({ providerKey: entry.providerKey, listKey: list.listKey })
      }
    }
    pairs.sort((a, b) => {
      const providerCmp = a.providerKey.localeCompare(b.providerKey)
      if (providerCmp !== 0) return providerCmp
      return a.listKey.localeCompare(b.listKey)
    })

    for (const [subIndex, pair] of pairs.entries()) {
      rankings.push({
        providerKey: pair.providerKey,
        listKey: pair.listKey,
        ranking: Number(base + BigInt(subIndex)),
      })
    }
  }

  return rankings
}

/** Module-level cached default order ID */
let cachedDefaultOrderId: viem.Hex | null = null
let syncLock = false
let refreshTimer: ReturnType<typeof setInterval> | null = null

/**
 * Get the cached default list order ID.
 * Returns null if no sync has run yet.
 */
export const getDefaultListOrderId = (): viem.Hex | null => cachedDefaultOrderId

/**
 * Sync the default list_order + list_order_item rows from collectable key order
 * and discovery manifests. Serialized — only one sync runs at a time.
 */
export const syncDefaultOrder = async (
  collectableKeys: string[],
  manifests: Map<string, DiscoveryManifest>,
): Promise<void> => {
  if (syncLock) return
  syncLock = true
  try {
    const rankings = computeRankings(collectableKeys, manifests)
    if (!rankings.length) return

    const [gibsProvider] = await db.insertProvider({ key: 'gibs' })

    const orderItems: BackfillableInsertableListOrderItem[] = rankings.map((r) => ({
      providerId: db.ids.provider(r.providerKey),
      listKey: r.listKey,
      ranking: r.ranking,
    }))

    await db.transaction(async (tx) => {
      // Find existing default order to clean up stale items
      const [existingOrder] = await tx(tableNames.listOrder)
        .where({ providerId: gibsProvider.providerId, key: 'default' })
        .select('listOrderId')

      if (existingOrder) {
        await tx(tableNames.listOrderItem)
          .where('listOrderId', existingOrder.listOrderId)
          .delete()
      }

      // Upsert the order + insert all items
      const { order } = await db.insertOrder(
        {
          providerId: gibsProvider.providerId,
          type: 'default',
          key: 'default',
        },
        orderItems,
        tx,
      )

      cachedDefaultOrderId = order.listOrderId as viem.Hex
    })
  } finally {
    syncLock = false
  }
}

/**
 * Build manifests from existing DB state (no discover phase needed).
 * Used by server startup and standalone create-orders script.
 */
export const buildManifestsFromDB = async (
  collectableKeys: string[],
): Promise<Map<string, DiscoveryManifest>> => {
  const manifests = new Map<string, DiscoveryManifest>()
  const t = db.getDB()

  const rows = await t
    .select([
      t.raw(`${tableNames.provider}.key as provider_key`),
      t.raw(`${tableNames.list}.key as list_key`),
    ])
    .from(tableNames.provider)
    .leftJoin(tableNames.list, {
      [`${tableNames.list}.providerId`]: `${tableNames.provider}.providerId`,
    })
    .whereNotNull(`${tableNames.list}.key`)

  // Group by provider key
  const byProvider = new Map<string, Array<{ listKey: string }>>()
  for (const row of rows as Array<{ provider_key: string; list_key: string }>) {
    const existing = byProvider.get(row.provider_key) ?? []
    existing.push({ listKey: row.list_key })
    byProvider.set(row.provider_key, existing)
  }

  // Map provider keys back to collectable keys
  for (const collectableKey of collectableKeys) {
    const entries: DiscoveryManifest = []
    for (const [providerKey, lists] of byProvider.entries()) {
      if (providerKey === collectableKey) {
        entries.push({ providerKey, lists })
        continue
      }
      if (collectableKey === 'uniswap-tokenlists' && providerKey.startsWith('uniswap-')) {
        entries.push({ providerKey, lists })
        continue
      }
      if (collectableKey === 'omnibridge' && providerKey.endsWith('-bridge')) {
        entries.push({ providerKey, lists })
        continue
      }
    }
    if (entries.length) {
      manifests.set(collectableKey, entries)
    }
  }

  return manifests
}

/**
 * Start periodic order refresh. Returns a stop function.
 */
export const startPeriodicRefresh = (
  collectableKeys: string[],
  manifests: Map<string, DiscoveryManifest>,
  intervalMs = 60_000,
): (() => void) => {
  refreshTimer = setInterval(() => {
    syncDefaultOrder(collectableKeys, manifests).catch(() => {
      // Swallow errors — stale order is better than crash
    })
  }, intervalMs)
  // Don't keep the process alive just for periodic refresh
  refreshTimer.unref()

  return () => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }
}
