/**
 * @module aggregator
 * The collector shape shared by the bridge aggregators.
 *
 * LiFi and Relay publish the same kind of thing in different words: one flat
 * catalogue of everything they will route, spanning far more chains than any
 * curated list, carrying a verdict per token about whether the source vouches
 * for it. Once each source has narrowed its own response into
 * `AggregatorToken`s, what remains is identical — group by chain, make a list
 * per chain, insert the tokens and fetch the artwork — so it is written once
 * here rather than once per source.
 *
 * One list per chain is how every other multi-chain collector in this package
 * files its tokens, and it is what lets `tokensByChain` answer for a chain
 * without reading rows belonging to every other one.
 */
import { failureLog, limitBy } from '@gibs/utils'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { groupByChain, dedupeByAddress, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

/** How many tokens are inserted at once. Matches the other collectors. */
const INSERT_CONCURRENCY = 8

/** What a source has to supply to become a collector. */
export interface AggregatorSource {
  /** Registry key, and the provider key written to the database. */
  providerKey: string
  /** Display name for the provider row. */
  providerName: string
  /** Fetch the catalogue and narrow it. Errors are the caller's to raise. */
  fetchCatalogue: (signal: AbortSignal) => Promise<ParsedCatalogue>
}

/** A token with the position it holds in its chain's list. */
type OrderedToken = AggregatorToken & { orderIdx: number }

/** One chain's list, produced by discover() and consumed by collect(). */
type PreparedList = {
  listKey: string
  listId: string
  networkId: string
  /** This list's own registered licence (see insertList), for effectiveEntryLicense. */
  license: string | null
  tokens: OrderedToken[]
}

/** The list key for a chain. Namespaced so it reads as a chain, not a number. */
export const chainListKey = (chainId: number): string => `chain-${chainId}`

export class AggregatorCollector extends BaseCollector {
  readonly key: string
  private readonly source: AggregatorSource
  private prepared: PreparedList[] = []

  constructor(source: AggregatorSource) {
    super()
    this.key = source.providerKey
    this.source = source
  }

  /**
   * Phase one: read the catalogue and create the provider and one list per chain.
   *
   * A chain whose network row cannot be created is skipped rather than allowed
   * to end the run. The database refuses a chain id that is a non-Ethereum
   * chain wearing an Ethereum number, and an aggregator adding a new chain is a
   * normal event — losing every other chain over one is not.
   */
  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const { providerKey, providerName } = this.source
    // Reuse an existing row rather than issuing a fresh one: the terminal
    // registry outlives a collect cycle and `complete()` only marks a row done,
    // so a bare issue() throws on the second cycle. Same idiom as jupiter.
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      const { tokens, rejected } = await this.source.fetchCatalogue(signal)
      if (signal.aborted) return []
      if (tokens.length === 0) {
        failureLog('provider=%o produced no tokens', providerKey)
        return []
      }
      // What was refused, and why, in one line. A source that quietly starts
      // failing its own verification check looks identical to a smaller
      // catalogue unless the refusals are reported.
      row.update({ kv: { kept: tokens.length, ...rejected } })

      const [provider] = await db.insertProvider({ key: providerKey, name: providerName })

      const prepared: PreparedList[] = []
      for (const [chainId, chainTokens] of groupByChain(tokens)) {
        if (signal.aborted) break
        const network = await db.insertNetworkFromChainId(chainId).catch((err: unknown) => {
          failureLog('provider=%o chain=%o refused: %o', providerKey, chainId, (err as Error).message)
          return null
        })
        if (!network) continue

        const listKey = chainListKey(chainId)
        const [list] = await db.insertList({
          providerId: provider.providerId,
          providerKey,
          networkId: network.networkId,
          key: listKey,
          name: `${providerName}: chain ${chainId}`,
        })
        prepared.push({
          listKey,
          listId: list.listId,
          networkId: network.networkId,
          license: list.license,
          tokens: dedupeByAddress(chainTokens).map((token, orderIdx) => ({ ...token, orderIdx })),
        })
      }

      this.prepared = prepared
      return [{ providerKey, lists: prepared.map((list) => ({ listKey: list.listKey, listId: list.listId })) }]
    } finally {
      row.complete()
    }
  }

  /** Phase two: insert each chain's tokens and fetch their artwork. */
  async collect(signal: AbortSignal): Promise<void> {
    if (this.prepared.length === 0) return
    const { providerKey } = this.source
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    const limit = limitBy<OrderedToken>(`${providerKey}-insert`, INSERT_CONCURRENCY)
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
          const counterId = `${list.listKey}:${token.address}`
          try {
            await db.fetchImageAndStoreForToken({
              listId: list.listId,
              listTokenOrderId: token.orderIdx,
              // An absent logo is null, not the empty string: the image path
              // takes `string | Buffer | null`, and '' would read as a location.
              uri: token.logoURI,
              originalUri: token.logoURI,
              providerKey,
              listLicense: list.license,
              signal,
              token: {
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                networkId: list.networkId,
                providedId: db.normalizeProvidedId(token.address),
              },
            })
            row.increment(terminalCounterTypes.TOKEN, counterId)
          } catch (err) {
            row.increment('erred', counterId)
            failureLog('token %o/%o/%o failed: %o', providerKey, list.listKey, token.address, (err as Error).message)
          }
        })
      }
    } finally {
      row.complete()
    }
  }
}
