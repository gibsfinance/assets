import { failureLog, limitBy } from '@gibs/utils'

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
/**
 * Jupiter's Token API V2 verified universe. This is the full set of quality-gated
 * Solana tokens (a few thousand), each richly tagged; the legacy 1M-token dump
 * endpoint no longer exists, and the unverified long tail is only reachable through
 * per-token search rather than a bulk feed.
 */
const verifiedUrl = 'https://lite-api.jup.ag/tokens/v2/tag?query=verified'
/** A tag list with fewer than this many tokens is skipped rather than created near-empty. */
const MIN_LIST_SIZE = 5

/** A parsed token carrying its stable insertion order within a single tag list. */
type OrderedToken = JupiterToken & { orderIdx: number }

/** One per-tag list, produced by discover() and consumed by collect(). */
type PreparedList = {
  tag: string
  listId: string
  tokens: OrderedToken[]
}

/**
 * Two-phase collector for Jupiter's verified Solana universe.
 *
 * Phase 1 (discover): fetches the verified set once, validates every record, then
 *   splits it into one list per meaningful tag (verified, lst, meme, rwa, ...). A
 *   token carrying several tags is filed into each matching list, so the lists
 *   overlap by design. Everything is registered under the CAIP-2 id `solana-501`.
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
      const raw = await db.cachedJSONRequest<unknown[]>(verifiedUrl, signal, verifiedUrl)
      if (signal.aborted) return []

      const records = Array.isArray(raw) ? raw : []
      const tokens: JupiterToken[] = []
      for (const record of records) {
        const parsed = parseJupiterToken(record)
        if (parsed) tokens.push(parsed)
      }
      if (tokens.length === 0) {
        failureLog('provider=%o produced no tokens from %o', providerKey, verifiedUrl)
        return []
      }

      const [provider] = await db.insertProvider({ key: providerKey, name: providerName })
      const network = await db.insertNetworkFromChainId(SOLANA_CHAIN_IDENTIFIER, SOLANA_NETWORK_TYPE)
      this.networkId = network.networkId

      const prepared: PreparedList[] = []
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
        prepared.push({
          tag,
          listId: list.listId,
          tokens: tagged.map((token, orderIdx) => ({ ...token, orderIdx })),
        })
      }

      this.prepared = prepared
      return [{ providerKey, lists: prepared.map((list) => ({ listKey: `tag-${list.tag}`, listId: list.listId })) }]
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
          new Set(list.tokens.map((token) => `${list.tag}:${token.address}`)),
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
            row.increment(terminalCounterTypes.TOKEN, `${list.tag}:${token.address}`)
          } catch (err) {
            row.increment('erred', `${list.tag}:${token.address}`)
            failureLog('token %o/%o/%o failed: %o', providerKey, list.tag, token.address, (err as Error).message)
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
