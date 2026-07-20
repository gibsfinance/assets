import { failureLog, limitBy } from '@gibs/utils'

import { fetch } from '../fetch'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import {
  parseJupiterToken,
  type JupiterToken,
  MEANINGFUL_TAGS,
  SOLANA_CHAIN_IDENTIFIER,
  SOLANA_NETWORK_TYPE,
} from './jupiter-parse'

const providerKey = 'jupiter'
const providerName = 'Jupiter'
const apiBase = 'https://lite-api.jup.ag/tokens/v2'

/**
 * Jupiter's Token API V2 verified universe. This is the full set of quality-gated
 * Solana tokens (a few thousand), each richly tagged; the legacy 1M-token dump
 * endpoint no longer exists, and the unverified long tail is only reachable through
 * per-token search rather than a bulk feed.
 */
const verifiedUrl = `${apiBase}/tag?query=verified`

/**
 * Jupiter's dynamic category feeds, each a separate list. Unlike the verified
 * universe these change constantly (what is trading, trending, or newly listed
 * right now), so they are fetched fresh every run rather than from the request
 * cache, and each collect run refreshes the list's membership.
 */
const CATEGORY_SOURCES: readonly { listKey: string; name: string; url: string }[] = [
  { listKey: 'top-traded-24h', name: 'Jupiter: top traded (24h)', url: `${apiBase}/toptraded/24h` },
  { listKey: 'top-trending-24h', name: 'Jupiter: top trending (24h)', url: `${apiBase}/toptrending/24h` },
  { listKey: 'top-organic-24h', name: 'Jupiter: top organic score (24h)', url: `${apiBase}/toporganicscore/24h` },
  { listKey: 'recent', name: 'Jupiter: recently listed', url: `${apiBase}/recent` },
]

/** A tag or category list with fewer than this many tokens is skipped rather than created near-empty. */
const MIN_LIST_SIZE = 5

/** A parsed token carrying its stable insertion order within a single list. */
type OrderedToken = JupiterToken & { orderIdx: number }

/** One list (tag-split or dynamic category), produced by discover() and consumed by collect(). */
type PreparedList = {
  /** The database list key, e.g. `tag-lst` or `top-traded-24h`; also labels the progress counters. */
  listKey: string
  listId: string
  tokens: OrderedToken[]
}

/** Narrow an API response array to validated Jupiter tokens. */
const narrowTokens = (raw: unknown): JupiterToken[] => {
  const records = Array.isArray(raw) ? raw : []
  const tokens: JupiterToken[] = []
  for (const record of records) {
    const parsed = parseJupiterToken(record)
    if (parsed) tokens.push(parsed)
  }
  return tokens
}

/** Attach a stable per-list insertion order to a set of tokens. */
const withOrder = (tokens: JupiterToken[]): OrderedToken[] => tokens.map((token, orderIdx) => ({ ...token, orderIdx }))

/**
 * Two-phase collector for Jupiter's Solana tokens.
 *
 * Phase 1 (discover): fetches the verified set once and splits it into one list
 *   per meaningful tag (verified, lst, meme, rwa, ...), then adds one list per
 *   dynamic category feed (top traded / trending / organic score over 24h, and
 *   recently listed). A token carrying several tags is filed into each matching
 *   list, so the lists overlap by design. Everything is registered under the
 *   CAIP-2 id `solana-501`.
 * Phase 2 (collect): inserts each list's tokens and fetches their logos.
 *
 * Solana cannot ride the generic remote-tokenlist path (it coerces chainId with
 * `+entry.chainId`, which is meaningless for a base58 mint), so this files tokens
 * the same way coingecko and trustwallet persist their non-Ethereum-Virtual-Machine
 * tokens: `insertNetworkFromChainId('solana-501', 'solana')` then per-token inserts.
 */
class JupiterCollector extends BaseCollector {
  readonly key = providerKey

  private networkId: string | null = null
  private prepared: PreparedList[] = []

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      const verifiedRaw = await db.cachedJSONRequest<unknown[]>(verifiedUrl, signal, verifiedUrl)
      if (signal.aborted) return []

      const tokens = narrowTokens(verifiedRaw)
      if (tokens.length === 0) {
        failureLog('provider=%o produced no tokens from %o', providerKey, verifiedUrl)
        return []
      }

      const [provider] = await db.insertProvider({ key: providerKey, name: providerName })
      const network = await db.insertNetworkFromChainId(SOLANA_CHAIN_IDENTIFIER, SOLANA_NETWORK_TYPE)
      this.networkId = network.networkId

      const prepared: PreparedList[] = []

      // One list per meaningful tag within the verified universe.
      for (const tag of MEANINGFUL_TAGS) {
        const tagged = tokens.filter((token) => token.tags.includes(tag))
        if (tagged.length < MIN_LIST_SIZE) {
          continue
        }
        const [list] = await db.insertList({
          providerId: provider.providerId,
          networkId: network.networkId,
          key: `tag-${tag}`,
          name: `Jupiter: ${tag}`,
        })
        prepared.push({ listKey: `tag-${tag}`, listId: list.listId, tokens: withOrder(tagged) })
      }

      // One list per dynamic category feed, fetched fresh (not from the request cache).
      for (const source of CATEGORY_SOURCES) {
        if (signal.aborted) break
        const raw = await fetch(source.url, { signal })
          .then((res) => res.json() as Promise<unknown>)
          .catch((err) => {
            failureLog('provider=%o source=%o error=%o', providerKey, source.listKey, (err as Error).message)
            return null
          })
        const categoryTokens = narrowTokens(raw)
        if (categoryTokens.length < MIN_LIST_SIZE) {
          continue
        }
        const [list] = await db.insertList({
          providerId: provider.providerId,
          networkId: network.networkId,
          key: source.listKey,
          name: source.name,
        })
        prepared.push({ listKey: source.listKey, listId: list.listId, tokens: withOrder(categoryTokens) })
      }

      this.prepared = prepared
      return [{ providerKey, lists: prepared.map((list) => ({ listKey: list.listKey, listId: list.listId })) }]
    } finally {
      row.complete()
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    const networkId = this.networkId
    if (!networkId || this.prepared.length === 0) return

    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    const limit = limitBy<OrderedToken>(`${providerKey}-insert`, 8)
    try {
      for (const list of this.prepared) {
        if (signal.aborted) return
        row.createCounter(terminalCounterTypes.TOKEN)
        row.incrementTotal(
          terminalCounterTypes.TOKEN,
          new Set(list.tokens.map((token) => `${list.listKey}:${token.address}`)),
        )
        await limit.map(list.tokens, async (token) => {
          if (signal.aborted) return
          // Empty logo must be null, not '' — fetchImageAndStoreForToken takes string | Buffer | null.
          const uri = token.logoURI || null
          try {
            await db.fetchImageAndStoreForToken({
              listId: list.listId,
              listTokenOrderId: token.orderIdx,
              uri,
              originalUri: uri,
              providerKey,
              signal,
              token: {
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                networkId,
                // Base58 mint, kept verbatim — normalizeProvidedId lowercases only hex ids.
                providedId: token.address,
              },
            })
            row.increment(terminalCounterTypes.TOKEN, `${list.listKey}:${token.address}`)
          } catch (err) {
            row.increment('erred', `${list.listKey}:${token.address}`)
            failureLog('token %o/%o/%o failed: %o', providerKey, list.listKey, token.address, (err as Error).message)
          }
        })
      }
    } finally {
      row.complete()
    }
  }
}

const instance = new JupiterCollector()
export default instance

/**
 * Standalone entry point that runs both phases, mirroring the other collectors'
 * convenience export.
 */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
