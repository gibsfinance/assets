import type { DiscoveryManifest } from '../collect/base-collector'
import type { BackfillableInsertableListOrderItem } from './schema-types'
import * as db from '.'
import * as viem from 'viem'
import { getDrizzle } from './drizzle'
import { eq, isNotNull } from 'drizzle-orm'
import * as s from './schema'

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
    const pairs: { providerKey: string; listKey: string }[] = []
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

    const drizzle = getDrizzle()
    await drizzle.transaction(async (tx) => {
      // Find existing default order to clean up stale items
      const [existingOrder] = await tx
        .select({ listOrderId: s.listOrder.listOrderId })
        .from(s.listOrder)
        .where(eq(s.listOrder.providerId, gibsProvider.providerId))
        .limit(1)

      if (existingOrder) {
        await tx.delete(s.listOrderItem).where(eq(s.listOrderItem.listOrderId, existingOrder.listOrderId))
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
export const buildManifestsFromDB = async (collectableKeys: string[]): Promise<Map<string, DiscoveryManifest>> => {
  const manifests = new Map<string, DiscoveryManifest>()
  const drizzle = getDrizzle()

  const rows = await drizzle
    .select({
      providerKey: s.provider.key,
      listKey: s.list.key,
    })
    .from(s.provider)
    .leftJoin(s.list, eq(s.list.providerId, s.provider.providerId))
    .where(isNotNull(s.list.key))

  // Group by provider key
  const byProvider = new Map<string, { listKey: string }[]>()
  for (const row of rows) {
    if (!row.providerKey || !row.listKey) continue
    const existing = byProvider.get(row.providerKey) ?? []
    existing.push({ listKey: row.listKey })
    byProvider.set(row.providerKey, existing)
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
