import * as db from '../db'
import { terminalCounterTypes, TerminalRowProxy, terminalRowTypes } from '../log/types'
import * as types from '../types'
import * as utils from '../utils'
import type { List, Network, Provider } from '../db/schema-types'
import type { DrizzleTx } from '../db/drizzle'
import { failureLog } from '@gibs/utils'
import { isPlaceholderUri } from '../image-placeholders'

/**
 * How many tokens share one transaction in `collect()`.
 *
 * Trades round trips against how much work a single bad entry forces the replay path to
 * redo. Small enough that a transaction stays short — every entry is database-only by the
 * time the loop runs, since prewarmImages has already done the downloading — and large
 * enough that the begin/commit overhead stops dominating.
 */
const TOKEN_WRITE_CHUNK = 250

type CollectInput = {
  providerKey: string
  listKey: string
  tokenList: types.TokenList
  isDefault?: boolean
  row?: TerminalRowProxy
  signal: AbortSignal
}

/** State produced by discover() and consumed by collect() */
export type DiscoveredState = {
  provider: Provider
  list: List
  chainIds: number[]
  networks: Map<number, Network>
}

/**
 * Phase 1: Register provider, list, and networks without processing tokens or images.
 * Returns shared state that can be passed to collect() for Phase 2.
 */
export const discover = async ({
  isDefault = false,
  providerKey,
  listKey,
  tokenList,
  row: ro,
  signal,
}: CollectInput): Promise<DiscoveredState | undefined> => {
  const id = `${providerKey}/${listKey}`
  const row =
    ro ??
    utils.terminal.get(id) ??
    utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id,
    })

  // Extract unique chain IDs from token list
  const chainIdSet = new Set<number>()
  for (const entry of tokenList.tokens) {
    chainIdSet.add(+entry.chainId)
  }
  const chainIds = [...chainIdSet.values()]
  const networks = new Map<number, Network>()

  let provider!: Provider
  let list!: List

  // Setup networks for each chain ID
  row.createCounter(terminalCounterTypes.NETWORK)
  row.incrementTotal(
    terminalCounterTypes.NETWORK,
    utils.mapToSet.network(chainIds, (id) => id),
  )
  for (const chainId of chainIds) {
    if (chainId) {
      const network = await db.insertNetworkFromChainId(chainId, undefined)
      if (signal.aborted) return undefined
      networks.set(chainId, network)
      row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
    }
  }
  if (signal.aborted) return undefined

  await db.transaction(async (tx) => {
    // Setup default network (chainId 0)
    await db.insertNetworkFromChainId(0, undefined, tx)

    // Create provider entry
    ;[provider] = await db.insertProvider(
      {
        key: providerKey,
      },
      tx,
    )

    // Create list entry
    ;[list] = await db.insertList(
      {
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(chainIds.length === 1 ? chainIds[0] : 0),
        name: tokenList.name,
        key: listKey,
        default: isDefault,
        description: '',
        ...(tokenList.version && {
          major: typeof tokenList.version.major === 'number' ? tokenList.version.major : 1,
          minor: typeof tokenList.version.minor === 'number' ? tokenList.version.minor : 0,
          patch: typeof tokenList.version.patch === 'number' ? tokenList.version.patch : 0,
        }),
      },
      tx,
    )

    // Store list logo if available
    if (tokenList.logoURI) {
      await db.fetchImageAndStoreForList(
        {
          listId: list.listId,
          uri: tokenList.logoURI,
          originalUri: tokenList.logoURI,
          providerKey,
        },
        tx,
      )
    }
  })

  return { provider, list, chainIds, networks }
}

/**
 * Phase 2 (or standalone): Process tokens and images.
 * Accepts optional pre-created state from discover() to skip re-creating provider/list.
 * If no state is provided, creates provider/list inline (backward compatible).
 */
export const collect = async (input: CollectInput & { discovered?: DiscoveredState }) => {
  const { isDefault = false, providerKey, listKey, tokenList, row: ro, signal, discovered } = input

  const id = `${providerKey}/${listKey}`
  const row =
    ro ??
    utils.terminal.get(id) ??
    utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id,
    })
  try {
    // Use pre-discovered state or run discovery inline (backward compatible)
    const state =
      discovered ??
      (await discover({
        isDefault,
        providerKey,
        listKey,
        tokenList,
        row,
        signal,
      }))
    if (!state) return
    const { list, networks } = state

    // Process tokens in batches
    row.createCounter(terminalCounterTypes.TOKEN)
    row.incrementTotal(
      terminalCounterTypes.TOKEN,
      utils.mapToSet.token(tokenList.tokens, (t) => [t.chainId, t.address]),
    )

    // Resolve every entry first, so the write loop below is pure database work and can be
    // grouped. Callers may pass module-level token arrays shared across collect runs —
    // never mutate the entries; normalize into locals instead.
    const planned = tokenList.tokens.flatMap((entry, index) => {
      const address = db.normalizeProvidedId(entry.address)
      const network = networks.get(entry.chainId)
      if (!network) {
        failureLog('no network found for %o %o', tokenList, entry)
        return []
      }
      // Drop the "this coin has no logo" addresses before they become link rows,
      // then fix malformed URLs. This used to compare a bare filename against a
      // whole logo address, so it never once matched — every CoinGecko-style
      // missing_large.png went through as if it were artwork.
      const logoURI = isPlaceholderUri(entry.logoURI as string) ? '' : entry.logoURI
      return [
        {
          chainTokenId: utils.counterId.token([entry.chainId, address]),
          listTokenOrderId: index,
          uri: logoURI?.replace('hhttps://', 'https://') || null,
          token: {
            name: entry.name,
            symbol: entry.symbol,
            decimals: entry.decimals,
            networkId: network.networkId,
            providedId: address,
          },
        },
      ]
    })
    if (signal.aborted) return

    // Download the logos concurrently and up front. Without this the loop below waits on
    // one socket at a time; with it, every entry finds its link already fresh and writes
    // without touching the network. A URI that could not be fetched is blanked rather than
    // left in place, so the loop does not re-attempt a host prewarming just proved dead —
    // the token is still stored, image-less, exactly as a failure inside the loop stored it.
    const { missing } = await db.prewarmImages({
      uris: planned.map((entry) => entry.uri),
      providerKey,
      listId: list.listId,
      signal,
    })
    const entries = planned.map((entry) => (entry.uri && missing.has(entry.uri) ? { ...entry, uri: null } : entry))
    if (signal.aborted) return

    /** Write one entry. Shared by the grouped path and the one-at-a-time replay below. */
    const store = async (entry: (typeof entries)[number], tx?: DrizzleTx) =>
      await db.fetchImageAndStoreForToken(
        {
          listId: list.listId,
          uri: entry.uri,
          originalUri: entry.uri,
          providerKey,
          token: entry.token,
          listTokenOrderId: entry.listTokenOrderId,
        },
        tx,
      )

    for (let start = 0; start < entries.length; start += TOKEN_WRITE_CHUNK) {
      if (signal.aborted) return
      const chunk = entries.slice(start, start + TOKEN_WRITE_CHUNK)
      try {
        // The fast path: one transaction for the whole chunk rather than one per token,
        // which removes a begin/commit round trip per entry. Safe to group only because
        // the version stays unpublished until this loop finishes, so no reader can
        // observe a chunk mid-write.
        const stored = await db.transaction(async (tx) => {
          const written: typeof chunk = []
          for (const entry of chunk) {
            // Checked per entry, not just per chunk: an abort is a shutdown, and carrying
            // on to the end of a two-hundred-and-fifty token chunk defeats it. Whatever
            // this transaction has already written still commits, which costs nothing —
            // the version is never published on this path, so no reader sees it, and the
            // next run upserts straight over it.
            if (signal.aborted) return written
            await store(entry, tx)
            written.push(entry)
          }
          return written
        })
        for (const entry of stored) {
          row.increment(terminalCounterTypes.TOKEN, entry.chainTokenId)
        }
      } catch (err) {
        // A failed statement aborts its whole transaction, so one bad entry would take the
        // other few hundred down with it. Replay the chunk one transaction at a time to
        // find out which — slow, but only for a chunk that already failed, and it restores
        // exactly the per-token isolation the ungrouped loop had.
        failureLog('chunk %o/%o failed, replaying singly: %o', providerKey, listKey, (err as Error).message)
        for (const entry of chunk) {
          if (signal.aborted) return
          try {
            await db.transaction(async (tx) => await store(entry, tx))
            row.increment(terminalCounterTypes.TOKEN, entry.chainTokenId)
          } catch (innerErr) {
            row.increment('erred', entry.chainTokenId)
            failureLog('token %o/%o failed: %o', providerKey, entry.chainTokenId, (innerErr as Error).message)
          }
        }
      }
    }

    // Publish. Every token has been attempted, so this version is now the best answer
    // available and readers may switch to it. The abort check is the load-bearing half:
    // an abort inside a chunk leaves the loop with entries never written, and publishing
    // that is precisely the half-written version this marker exists to hide. Individual
    // token failures were logged and skipped, and do not withhold publication — see
    // markListTokensCollected.
    if (signal.aborted) return
    await db.markListTokensCollected(list.listId)
  } finally {
    // Only complete the row if we created it (not passed from caller)
    if (!ro) {
      row.complete()
    }
  }
}
