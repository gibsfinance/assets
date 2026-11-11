import { failureLog, limitBy } from '@gibs/utils'

import { fetch } from '../fetch'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, type DiscoveryManifest } from './base-collector'
import { nextListVersion } from './list-membership'
import { publishWalkedList, resolveListVersion } from './list-publication'
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
 * cache, and each collect run replaces the list's membership: a token the feed no
 * longer returns leaves the list (see `resolveListVersion`).
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
  providerId: string
  /** The database list key, e.g. `tag-lst` or `top-traded-24h`; also labels the progress counters. */
  listKey: string
  listId: string
  /** This list's own registered licence (see insertList), for effectiveEntryLicense. */
  license: string | null
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
 * Stop listing members for every Jupiter list this run did not produce.
 *
 * A list is stale when it is stored but absent from `liveKeys`: a tag that fell below
 * MIN_LIST_SIZE or that Jupiter retired (`yield`), or a list the collector no longer
 * defines. Lists in `unreliableKeys` are skipped because their feed failed or came back
 * empty, which says nothing about their members.
 *
 * Retiring publishes a new, empty version, which the list readers serve in place of the
 * older versions (see `getLists`). That is the same mechanism a membership change uses, so
 * the old rows stay available to the image route. A list already empty is left alone, so
 * a retired list costs one version, once.
 */
const retireStaleLists = async ({
  providerId,
  providerKey: ownerKey,
  liveKeys,
  unreliableKeys,
}: {
  providerId: string
  providerKey: string
  liveKeys: Set<string>
  unreliableKeys: Set<string>
}): Promise<void> => {
  const storedKeys = await db.getProviderListKeys(providerId)
  for (const listKey of storedKeys) {
    if (liveKeys.has(listKey) || unreliableKeys.has(listKey)) continue
    const { highest, published } = await db.getListVersionSnapshot({ providerId, listKey })
    if (!highest || !published || published.providedIds.length === 0) continue
    const [emptied] = await db.insertList({
      providerId,
      providerKey: ownerKey,
      networkId: published.networkId,
      key: listKey,
      name: published.name,
      ...nextListVersion(highest),
    })
    await db.markListTokensCollected(emptied.listId)
    failureLog('provider=%o list=%o retired: no longer produced by the feed', ownerKey, listKey)
  }
}

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
    // Reuse an existing row rather than issuing a fresh one: the terminal registry
    // persists across collect cycles and `complete()` only marks a row done without
    // removing it, so a bare issue() throws `duplicated row jupiter` on the second
    // cycle — and collides with collect()'s row within a single cycle. This is the
    // same get-or-issue idiom inmemory-tokenlist uses for exactly this reason.
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
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
      // Lists whose feed gave no usable answer this run. They keep what they have.
      const unreliableKeys = new Set<string>()

      // One list per meaningful tag within the verified universe.
      for (const tag of MEANINGFUL_TAGS) {
        const tagged = tokens.filter((token) => token.tags.includes(tag))
        if (tagged.length < MIN_LIST_SIZE) {
          continue
        }
        const [list] = await db.insertList({
          providerId: provider.providerId,
          providerKey,
          networkId: network.networkId,
          key: `tag-${tag}`,
          name: `Jupiter: ${tag}`,
          ...(await resolveListVersion({
            providerId: provider.providerId,
            listKey: `tag-${tag}`,
            addresses: tagged.map((token) => token.address),
          })),
        })
        prepared.push({
          providerId: provider.providerId,
          listKey: `tag-${tag}`,
          listId: list.listId,
          license: list.license,
          tokens: withOrder(tagged),
        })
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
        if (categoryTokens.length === 0) {
          // A failed request or an empty answer is not evidence that the feed is empty.
          unreliableKeys.add(source.listKey)
          continue
        }
        if (categoryTokens.length < MIN_LIST_SIZE) {
          continue
        }
        const [list] = await db.insertList({
          providerId: provider.providerId,
          providerKey,
          networkId: network.networkId,
          key: source.listKey,
          name: source.name,
          ...(await resolveListVersion({
            providerId: provider.providerId,
            listKey: source.listKey,
            addresses: categoryTokens.map((token) => token.address),
          })),
        })
        prepared.push({
          providerId: provider.providerId,
          listKey: source.listKey,
          listId: list.listId,
          license: list.license,
          tokens: withOrder(categoryTokens),
        })
      }

      // An aborted run saw only part of the feeds, so it cannot say which lists are stale.
      if (signal.aborted) return []
      await retireStaleLists({
        providerId: provider.providerId,
        providerKey,
        liveKeys: new Set(prepared.map((list) => list.listKey)),
        unreliableKeys,
      })

      this.prepared = prepared
      return [{ providerKey, lists: prepared.map((list) => ({ listKey: list.listKey, listId: list.listId })) }]
    } finally {
      row.complete()
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    const networkId = this.networkId
    if (!networkId || this.prepared.length === 0) return

    // Reuse discover()'s row (still registered, since complete() never removes it)
    // rather than issuing a duplicate — a bare issue() here threw `duplicated row
    // jupiter` and aborted the whole collect before a single token was inserted.
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    const limit = limitBy<OrderedToken>(`${providerKey}-insert`, 8)
    try {
      for (const list of this.prepared) {
        if (signal.aborted) return
        row.createCounter(terminalCounterTypes.TOKEN)
        row.incrementTotal(
          terminalCounterTypes.TOKEN,
          new Set(list.tokens.map((token) => `${list.listKey}:${token.address}`)),
        )
        let stored = 0
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
              listLicense: list.license,
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
            stored += 1
            row.increment(terminalCounterTypes.TOKEN, `${list.listKey}:${token.address}`)
          } catch (err) {
            row.increment('erred', `${list.listKey}:${token.address}`)
            failureLog('token %o/%o/%o failed: %o', providerKey, list.listKey, token.address, (err as Error).message)
          }
        })
        await publishWalkedList({
          providerKey,
          providerId: list.providerId,
          listKey: list.listKey,
          listId: list.listId,
          stored,
          signal,
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
