import { failureLog, limitBy } from '@gibs/utils'

import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import {
  parseSolanaTokenRecord,
  type SolanaTokenEntry,
  SOLANA_CHAIN_IDENTIFIER,
  SOLANA_NETWORK_TYPE,
} from './solana-tokenlist-parse'

const providerKey = 'solana-labs'
const providerName = 'Solana Labs'
const listKey = 'token-list'
const sourceUrl = 'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json'

/** The assembled solana-labs list is a standard token-list document. */
type SolanaTokenListDocument = { tokens?: unknown[] }

/** A parsed token carrying its stable insertion order. */
type OrderedToken = SolanaTokenEntry & { orderIdx: number }

/** State produced by discover() and consumed by collect(). */
type PreparedList = {
  listId: string
  networkId: string
  tokens: OrderedToken[]
}

/**
 * Two-phase collector for the solana-labs/token-list registry.
 *
 * Phase 1 (discover): fetches the assembled list, validates every record, and
 *   registers the provider, the `solana-501` network, and the list.
 * Phase 2 (collect): inserts each mainnet token and fetches its logo.
 *
 * Solana cannot ride the generic remote-tokenlist path: that path calls
 * `insertNetworkFromChainId(+entry.chainId)`, which turns the Solana cluster id
 * 101 into a bogus `eip155-101` network. This collector files everything under
 * the CAIP-2 id `solana-501` with type `solana` instead, matching how coingecko
 * and trustwallet persist their non-Ethereum-Virtual-Machine tokens.
 */
class SolanaTokenListCollector extends BaseCollector {
  readonly key = providerKey

  private prepared: PreparedList | null = null

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      const document = await db.cachedJSONRequest<SolanaTokenListDocument>(sourceUrl, signal, sourceUrl)
      if (signal.aborted) return []

      const rawTokens = Array.isArray(document?.tokens) ? document.tokens : []
      const tokens: OrderedToken[] = []
      for (const raw of rawTokens) {
        const parsed = parseSolanaTokenRecord(raw)
        if (parsed) {
          tokens.push({ ...parsed, orderIdx: tokens.length })
        }
      }
      if (tokens.length === 0) {
        failureLog('provider=%o produced no mainnet tokens from %o', providerKey, sourceUrl)
        return []
      }

      // Insert the provider with its name so the row never carries a null name.
      const [provider] = await db.insertProvider({ key: providerKey, name: providerName })
      const network = await db.insertNetworkFromChainId(SOLANA_CHAIN_IDENTIFIER, SOLANA_NETWORK_TYPE)
      const [list] = await db.insertList({
        providerId: provider.providerId,
        networkId: network.networkId,
        key: listKey,
      })

      this.prepared = { listId: list.listId, networkId: network.networkId, tokens }
      return [{ providerKey, lists: [{ listKey, listId: list.listId }] }]
    } finally {
      row.complete()
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    const prepared = this.prepared
    if (!prepared) return

    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    row.createCounter(terminalCounterTypes.TOKEN)
    row.incrementTotal(terminalCounterTypes.TOKEN, new Set(prepared.tokens.map((token) => token.address)))

    const limit = limitBy<OrderedToken>(`${providerKey}-insert`, 8)
    try {
      await limit.map(prepared.tokens, async (token) => {
        if (signal.aborted) return
        // Empty logo must be null, not '' — fetchImageAndStoreForToken takes string | Buffer | null.
        const uri = token.logoURI || null
        try {
          await db.fetchImageAndStoreForToken({
            listId: prepared.listId,
            listTokenOrderId: token.orderIdx,
            uri,
            originalUri: uri,
            providerKey,
            signal,
            token: {
              name: token.name,
              symbol: token.symbol,
              decimals: token.decimals,
              networkId: prepared.networkId,
              // Base58 mint, kept verbatim — normalizeProvidedId lowercases only hex ids.
              providedId: token.address,
            },
          })
          row.increment(terminalCounterTypes.TOKEN, token.address)
        } catch (err) {
          row.increment('erred', token.address)
          failureLog('token %o/%o failed: %o', providerKey, token.address, (err as Error).message)
        }
      })
    } finally {
      row.complete()
    }
  }
}

const instance = new SolanaTokenListCollector()
export default instance

/**
 * Standalone entry point that runs both phases, mirroring the other collectors'
 * convenience export.
 */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
