import * as db from '../db'
import { terminalCounterTypes, TerminalRowProxy, terminalRowTypes } from '../log/types'
import * as types from '../types'
import * as utils from '../utils'
import type { List, Network, Provider } from 'knex/types/tables'
import { failureLog } from '@gibs/utils'

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
    const blacklist = new Set<string>(['missing_large.png', 'missing_thumb.png'])
    row.createCounter(terminalCounterTypes.TOKEN)
    row.incrementTotal(
      terminalCounterTypes.TOKEN,
      utils.mapToSet.token(tokenList.tokens, (t) => [t.chainId, t.address]),
    )
    for (const [i, entry] of tokenList.tokens.entries()) {
      const chainTokenId = utils.counterId.token([entry.chainId, entry.address])
      if (signal.aborted) return
      const network = networks.get(entry.chainId)!
      if (!network) {
        failureLog('no network found for %o %o', tokenList, entry)
        continue
      }
      try {
        await db.transaction(async (tx) => {
          const token = {
            name: entry.name,
            symbol: entry.symbol,
            decimals: entry.decimals,
            networkId: network.networkId,
            providedId: entry.address,
          }

          // Skip blacklisted images
          if (blacklist.has(entry.logoURI as string)) {
            entry.logoURI = ''
          }

          // Fix malformed URLs and store token image
          const path = entry.logoURI?.replace('hhttps://', 'https://') || null
          await db.fetchImageAndStoreForToken(
            {
              listId: list.listId,
              uri: path,
              originalUri: path,
              providerKey,
              token,
              listTokenOrderId: i,
            },
            tx,
          )
        })
        row.increment(terminalCounterTypes.TOKEN, chainTokenId)
      } catch (err) {
        row.increment('erred', chainTokenId)
        failureLog('token %o/%o failed: %o', providerKey, chainTokenId, (err as Error).message)
      }
    }
  } finally {
    // Only complete the row if we created it (not passed from caller)
    if (!ro) {
      row.complete()
    }
  }
}
