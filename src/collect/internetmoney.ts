import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as utils from '@/utils'
import { fetch } from '@/fetch'
import * as db from '@/db'
import { Tx } from '@/db/tables'
import type { List, Provider } from 'knex/types/tables'
import promiseLimit from 'promise-limit'
import _ from 'lodash'
import { counterTypes, rowTypes } from '@/log/types'

const baseUrl = 'https://api.internetmoney.io/api/v1/networks'
const CONCURRENT_TOKENS = 4 // Limit concurrent token processing

interface TokenInfo {
  address: string
  icon: string
}

interface NetworkInfo {
  chainId: number
  rpc: string
  icon: string
  tokens: TokenInfo[]
}

const providerKey = 'internetmoney'
const networkToChain = (network: NetworkInfo) => {
  let chain = utils.findChain(network.chainId)
  if (!chain) {
    chain = {
      id: network.chainId,
      contracts: chains.mainnet.contracts,
      rpcUrls: {
        default: {
          http: [network.rpc],
        },
      },
    } as unknown as viem.Chain
  }
  return chain
}

/**
 * Main collection function that processes Internet Money networks and tokens
 */
export const collect = async () => {
  const section = utils.terminal.issue(providerKey)
  const summaryRow = section.issue({
    type: rowTypes.SUMMARY,
    id: providerKey,
  })
  const tasksSection = summaryRow.issue('tasks')

  const json = await fetch(baseUrl)
    .then((res): Promise<NetworkInfo[]> => res.json())
    .then((res) => (Array.isArray(res) ? res : []))
  const encounteredChainIds = new Set<bigint>()
  let provider!: Provider
  let insertedList!: List

  await db.transaction(async (tx) => {
    ;[provider] = await db.insertProvider(
      {
        name: 'Internet Money',
        key: providerKey,
      },
      tx,
    )
    await db.insertNetworkFromChainId(0, undefined, tx)
    ;[insertedList] = await db.insertList(
      {
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(0),
        key: 'wallet',
        name: 'default wallet list',
        description: 'the list that loads by default in the wallet',
        default: true,
      },
      tx,
    )
  })

  let totalTokens = 0
  for (const network of json) {
    totalTokens += network.tokens.length
  }

  summaryRow.createCounter(counterTypes.NETWORK, json.length)
  summaryRow.createCounter(counterTypes.TOKEN, totalTokens)
  // Process tokens in parallel with controlled concurrency
  type NetworkAndToken = [NetworkInfo, TokenInfo]
  const networkLimiter = promiseLimit<NetworkInfo>(CONCURRENT_TOKENS)
  const limit = promiseLimit<NetworkAndToken>(CONCURRENT_TOKENS)
  const networkToNetworkList = await networkLimiter.map(json, async (network) => {
    summaryRow.increment(counterTypes.NETWORK)
    const row = tasksSection.task(network.chainId.toString(), {
      type: rowTypes.STORAGE,
      id: providerKey,
      kv: {
        chainId: network.chainId,
      },
    })
    const chain = networkToChain(network)
    await db.insertNetworkFromChainId(chain.id)

    encounteredChainIds.add(BigInt(chain.id))

    const insertAndGetNetworkList = (t: Tx) => {
      return db.insertList(
        {
          providerId: provider.providerId,
          networkId: utils.chainIdToNetworkId(chain.id),
          key: `wallet-${chain.id}`,
          name: `default wallet list for chain ${chain.id}`,
          description: `the list that loads by default in the wallet for ${chain.id}`,
        },
        t,
      )
    }

    // Store network icon
    const networkListItem = await db.transaction(async (tx) => {
      const [networkList] = await insertAndGetNetworkList(tx)
      await db.fetchImageAndStoreForList(
        {
          listId: networkList.listId,
          uri: network.icon,
          originalUri: network.icon,
          providerKey: provider.key,
        },
        tx,
      )
      return [network, networkList] as const
    })
    row.unmount()
    return networkListItem
  })

  const networkListByNetwork = new Map(networkToNetworkList)
  const allTokens = _.flatMap(json, (network) => {
    return network.tokens.map((tkn) => [network, tkn] as NetworkAndToken)
  })

  await limit.map(allTokens, async ([network, token]) => {
    summaryRow.increment(counterTypes.TOKEN)
    const row = tasksSection.task(`${network.chainId}-${token.address}`.toLowerCase(), {
      type: rowTypes.STORAGE,
      id: providerKey,
      kv: {
        chainId: network.chainId,
        address: token.address,
      },
    })
    const address = viem.getAddress(token.address)
    const chain = networkToChain(network)
    const client = utils.chainToPublicClient(chain)
    const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)

    const networkList = networkListByNetwork.get(network)!
    await db
      .transaction(async (tx) => {
        const insertion = {
          uri: token.icon,
          originalUri: token.icon,
          providerKey: provider.key,
          token: {
            symbol,
            name,
            decimals,
            networkId: utils.chainIdToNetworkId(chain.id),
            providedId: address,
          },
        }
        await db.fetchImageAndStoreForToken(
          {
            ...insertion,
            listId: networkList.listId,
          },
          tx,
        )
        await db.fetchImageAndStoreForToken(
          {
            ...insertion,
            listId: insertedList.listId,
          },
          tx,
        )
      })
      .catch((err) => {
        if (err.message?.toLowerCase()?.includes('timeout')) {
          row.increment('timeout')
        } else {
          row.increment('error')
        }
        utils.failureLog(`${providerKey} ${chain.id} ${address} ${err.message}`)
      })
      .finally(() => {
        row.unmount()
      })
  })
  summaryRow.complete()
}
