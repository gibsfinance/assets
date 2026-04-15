import { isAddress, getAddress } from 'viem'
import { delay } from '../utils/delay'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { limitBy } from '@gibs/utils'
import { limitByTime } from '@gibs/utils/fetch'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { toCAIP2 } from '../chain-id'

const CHUNK_SIZE = 250
const DAY_MS = 24 * 60 * 60 * 1000

const apiKey = process.env.COINGECKO_API_KEY
// Pro plan uses a different hostname; demo/anonymous use the public endpoint
const API_BASE = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
const keyParam = apiKey ? `&x_cg_pro_api_key=${apiKey}` : ''
if (!apiKey) console.warn('[coingecko] COINGECKO_API_KEY not set — using anonymous tier (5–15 req/min)')

// Stable cache keys — no API key in them so cached data survives key rotation
const PLATFORMS_CACHE_KEY = `${API_BASE}/asset_platforms`
const COINS_LIST_CACHE_KEY = `${API_BASE}/coins/list?include_platform=true`

// Actual fetch URLs — include key for auth
const PLATFORMS_URL = apiKey ? `${PLATFORMS_CACHE_KEY}?x_cg_pro_api_key=${apiKey}` : PLATFORMS_CACHE_KEY
const COINS_LIST_URL = `${COINS_LIST_CACHE_KEY}${keyParam}`
const MARKETS_BASE = `${API_BASE}/coins/markets`

// Pro key: 500 req/min → 150ms spacing with headroom. No key: 15s to stay under anonymous floor.
const insertLimit = limitBy<ChainCoin>('coingecko-insert', 4)
const rateLimiter = limitByTime(apiKey ? 150 : 15_000)

const providerKey = 'coingecko'

type AssetPlatform = {
  id: string
  chain_identifier: number | null
  name: string
}

type CoinEntry = {
  id: string
  symbol: string
  name: string
  platforms: Record<string, string>
}

type MarketCoin = {
  id: string
  image: string
}

type ChainCoin = {
  coinId: string
  symbol: string
  name: string
  address: string
  chainId: number
  networkId: string
  listId: string
  orderIdx: number
}

/**
 * Two-phase collector for CoinGecko tokens using only public API endpoints.
 *
 * Phase 1 (discover): fetches asset_platforms + coins/list, builds per-chain
 * token tables, registers lists in the DB.
 *
 * Phase 2 (collect): batch-fetches coin images via coins/markets (250 per
 * request) then inserts tokens with their CoinGecko image URLs.
 *
 * No API key required.
 */
class CoinGeckoCollector extends BaseCollector {
  readonly key = 'coingecko'

  // All EVM coins discovered during discover(), keyed by coingecko platform id
  private platformCoins = new Map<string, ChainCoin[]>()

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    // --- 1. Fetch platform → chain_id mapping ---
    const platforms = await db.cachedJSON<AssetPlatform[]>(
      PLATFORMS_CACHE_KEY,
      signal,
      async (sig) => fetch(PLATFORMS_URL, { signal: sig }).then((r) => r.json()),
      { validate: Array.isArray, ttl: DAY_MS },
    )
    if (!Array.isArray(platforms)) {
      const body = platforms as { status?: { error_code?: number; error_message?: string } }
      if (body?.status?.error_code === 10006) {
        console.error('[coingecko] monthly call limit exhausted — skipping (resets next month or rotate key)')
      } else {
        console.warn('[coingecko] asset_platforms returned non-array — %o', platforms)
      }
      return []
    }

    const platformToChain = new Map<string, number>()
    for (const p of platforms) {
      if (p.chain_identifier && typeof p.chain_identifier === 'number') {
        platformToChain.set(p.id, p.chain_identifier)
      }
    }

    // --- 2. Fetch all coins with platform addresses ---
    const coinsList = await db.cachedJSON<CoinEntry[]>(
      COINS_LIST_CACHE_KEY,
      signal,
      async (sig) => fetch(COINS_LIST_URL, { signal: sig }).then((r) => r.json()),
      { validate: Array.isArray, ttl: DAY_MS },
    )
    if (!Array.isArray(coinsList)) {
      console.warn('[coingecko] coins/list returned non-array — %o', coinsList)
      return []
    }

    // --- 3. Build per-platform coin lists (EVM only, valid addresses) ---
    const platformCoinsTmp = new Map<
      string,
      { coinId: string; symbol: string; name: string; address: string; chainId: number }[]
    >()
    for (const coin of coinsList) {
      if (!coin.platforms) continue
      for (const [platformId, rawAddress] of Object.entries(coin.platforms)) {
        const chainId = platformToChain.get(platformId)
        if (!chainId) continue
        if (!isAddress(rawAddress)) continue
        const address = getAddress(rawAddress)
        const existing = platformCoinsTmp.get(platformId) ?? []
        existing.push({ coinId: coin.id, symbol: coin.symbol, name: coin.name, address, chainId })
        platformCoinsTmp.set(platformId, existing)
      }
    }

    if (platformCoinsTmp.size === 0) {
      console.warn('[coingecko] no EVM tokens found in coins/list')
      return []
    }

    // --- 4. Create provider + per-platform lists, populate this.platformCoins ---
    const [provider] = await db.insertProvider({ key: providerKey, name: 'CoinGecko' })

    const lists: { listKey: string }[] = []
    for (const [platformId, coins] of platformCoinsTmp) {
      const chainId = coins[0]!.chainId
      const listKey = String(chainId) // e.g. "56" — consistent with chain ID usage elsewhere
      const network = await db.insertNetworkFromChainId(chainId)
      const [dbList] = await db.insertList({
        providerId: provider.providerId,
        networkId: network.networkId,
        key: listKey,
      })

      const chainCoins: ChainCoin[] = coins.map((c, i) => ({
        ...c,
        networkId: network.networkId,
        listId: dbList.listId,
        orderIdx: i,
      }))
      this.platformCoins.set(platformId, chainCoins)
      lists.push({ listKey })
    }

    return [{ providerKey, lists }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      if (this.platformCoins.size === 0) {
        row.increment('skipped', providerKey)
        return
      }

      // --- 1. Collect all unique coin IDs across all chains ---
      const allCoinIds = new Set<string>()
      for (const coins of this.platformCoins.values()) {
        for (const c of coins) allCoinIds.add(c.coinId)
      }
      const coinIdList = [...allCoinIds]
      console.log(`[coingecko] ${this.platformCoins.size} EVM platforms, ${coinIdList.length} unique coins`)

      // --- 2. Batch-fetch images via coins/markets ---
      const imageMap = new Map<string, string>() // coinId → image URL
      const chunks: string[][] = []
      for (let i = 0; i < coinIdList.length; i += CHUNK_SIZE) {
        chunks.push(coinIdList.slice(i, i + CHUNK_SIZE))
      }
      console.log(`[coingecko] fetching images: ${chunks.length} chunks of ${CHUNK_SIZE}`)

      row.createCounter('chunks')
      row.incrementTotal('chunks', new Set(chunks.map((_, i) => String(i))))

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci]!
        if (signal.aborted) return
        await rateLimiter()
        const url = `${MARKETS_BASE}?ids=${chunk.join(',')}&vs_currency=usd&per_page=${CHUNK_SIZE}${keyParam}`
        let retries = 0
        for (;;) {
          if (signal.aborted) return
          try {
            const markets = await fetch(url, { signal }).then((r) => {
              if (r.status === 429) throw new Error('HTTP 429')
              if (!r.ok) throw new Error(`HTTP ${r.status}`)
              return r.json() as Promise<MarketCoin[]>
            })
            if (Array.isArray(markets)) {
              for (const coin of markets) {
                if (coin.id && coin.image) imageMap.set(coin.id, coin.image)
              }
            }
            console.log(`[coingecko] chunk ${ci + 1}/${chunks.length} done — ${imageMap.size} images so far`)
            break
          } catch (err) {
            if (signal.aborted) return
            retries++
            if (retries > 5) {
              console.warn(`[coingecko] chunk ${ci + 1}/${chunks.length} failed after ${retries} retries, skipping`)
              break
            }
            const msg = err instanceof Error ? err.message : String(err)
            const isRateLimit = msg.includes('429')
            const backoff = isRateLimit ? 60_000 : 5_000 * retries
            console.log(
              `[coingecko] chunk ${ci + 1}/${chunks.length} retry ${retries}/5 — ${msg}${isRateLimit ? ' (rate limited, waiting 60s)' : ''}`,
            )
            await delay(backoff, signal).catch(() => {})
          }
        }
        row.increment('chunks', new Set([String(ci)]))
      }
      console.log(`[coingecko] images fetched: ${imageMap.size} / ${coinIdList.length} coins have images`)

      // --- 3. Insert tokens per chain ---
      const [provider] = await db.insertProvider({ key: providerKey, name: 'CoinGecko' })

      row.createCounter(terminalCounterTypes.NETWORK)
      row.incrementTotal(terminalCounterTypes.NETWORK, new Set([...this.platformCoins.keys()]))

      let platformIdx = 0
      for (const [platformId, coins] of this.platformCoins) {
        if (signal.aborted) return
        platformIdx++
        const section = row.issue(platformId)
        const withImage = coins.filter((c) => imageMap.has(c.coinId))
        const caip2 = toCAIP2(String(coins[0]!.chainId))
        const netLabel = `(${platformIdx}/${this.platformCoins.size}) ${platformId} → ${caip2}`
        console.log(`[coingecko] ${netLabel}: starting ${withImage.length}/${coins.length} tokens have images`)

        row.createCounter(terminalCounterTypes.TOKEN)
        row.incrementTotal(terminalCounterTypes.TOKEN, new Set(coins.map((c) => c.coinId)))

        let inserted = 0
        await insertLimit.map(coins, async (coin) => {
          if (signal.aborted) return

          const imageUri = imageMap.get(coin.coinId)
          if (!imageUri) {
            row.increment('skipped', coin.coinId)
            return
          }

          await db
            .fetchImageAndStoreForToken({
              listId: coin.listId,
              uri: imageUri,
              originalUri: imageUri,
              providerKey: provider.key,
              listTokenOrderId: coin.orderIdx,
              signal,
              token: {
                name: coin.name,
                symbol: coin.symbol,
                decimals: 0,
                networkId: coin.networkId,
                providedId: coin.address,
              },
            })
            .catch(() => {})

          inserted++
          if (inserted % 250 === 0) {
            console.log(`[coingecko] ${netLabel}: ${inserted}/${withImage.length} inserted`)
          }
          row.increment(terminalCounterTypes.TOKEN, coin.coinId)
        })

        console.log(`[coingecko] ${netLabel}: done — ${inserted}/${withImage.length} inserted`)
        row.increment(terminalCounterTypes.NETWORK, platformId)
        void section
      }
    } finally {
      row.complete()
    }
  }
}

export default CoinGeckoCollector

export const collect = async (signal: AbortSignal) => {
  const collector = new CoinGeckoCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
