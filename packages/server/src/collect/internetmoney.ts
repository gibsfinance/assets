import * as chains from 'viem/chains'
import * as viem from 'viem'
import { erc20Read, failureLog } from '@gibs/utils'

import * as utils from '../utils'
import { fetch } from '../fetch'
import * as db from '../db'
import { Tx } from '../db/tables'
import type { List, Provider } from 'knex/types/tables'
import promiseLimit from 'promise-limit'
import _ from 'lodash'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const baseUrl = 'https://api.internetmoney.io/api/v1/networks'
const CONCURRENT_TOKENS = 16

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
 * Two-phase collector for Internet Money networks and tokens.
 * Phase 1 (discover): calls the networks API, creates provider + per-network lists.
 * Phase 2 (collect): processes tokens for each network.
 */
class InternetMoneyCollector extends BaseCollector {
  readonly key = 'internetmoney'

  private networkData: NetworkInfo[] = []
  private provider!: Provider
  private insertedList!: List
  private networkListByNetwork = new Map<NetworkInfo, List>()

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const json = await fetch(baseUrl, { signal })
      .then((res): Promise<NetworkInfo[]> => res.json())
      .then((res) => (Array.isArray(res) ? res : []))

    if (signal.aborted) return []

    // Create provider and default wallet list
    await db.transaction(async (tx) => {
      ;[this.provider] = await db.insertProvider(
        {
          name: 'Internet Money',
          key: providerKey,
        },
        tx,
      )
      await db.insertNetworkFromChainId(0, undefined, tx)
      ;[this.insertedList] = await db.insertList(
        {
          providerId: this.provider.providerId,
          networkId: utils.chainIdToNetworkId(0),
          key: 'wallet',
          name: 'default wallet list',
          description: 'the list that loads by default in the wallet',
          default: true,
        },
        tx,
      )
    })

    // Create per-network lists
    const lists: Array<{ listKey: string; listId?: string }> = [
      { listKey: 'wallet', listId: this.insertedList.listId },
    ]

    const networkLimiter = promiseLimit<NetworkInfo>(CONCURRENT_TOKENS)
    const networkToNetworkList = await networkLimiter.map(json, async (network) => {
      const chain = networkToChain(network)
      await db.insertNetworkFromChainId(chain.id)

      const listKey = `wallet-${chain.id}`
      const [networkList] = await db.insertList({
        providerId: this.provider.providerId,
        networkId: utils.chainIdToNetworkId(chain.id),
        key: listKey,
        name: `default wallet list for chain ${chain.id}`,
        description: `the list that loads by default in the wallet for ${chain.id}`,
      })

      lists.push({ listKey, listId: networkList.listId })
      return [network, networkList] as const
    })

    this.networkListByNetwork = new Map(networkToNetworkList)
    this.networkData = json

    return [{ providerKey, lists }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const summaryRow = utils.terminal.issue({
      id: providerKey,
      type: terminalRowTypes.SUMMARY,
    })
    try {
      const tasksSection = summaryRow.issue('tasks')

      summaryRow.createCounter(terminalCounterTypes.NETWORK)
      summaryRow.incrementTotal(
        terminalCounterTypes.NETWORK,
        utils.mapToSet.network(this.networkData, (n) => n.chainId),
      )

      summaryRow.incrementTotal(
        terminalCounterTypes.TOKEN,
        utils.mapToSet.token(
          this.networkData.flatMap((n) => n.tokens.map((t) => [n.chainId, t.address] as [number, string])),
          (t) => t,
        ),
      )

      // Store network icons
      const networkLimiter = promiseLimit<NetworkInfo>(CONCURRENT_TOKENS)
      await networkLimiter.map(this.networkData, async (network) => {
        summaryRow.increment(terminalCounterTypes.NETWORK, network.chainId.toString())
        const row = tasksSection.task(network.chainId.toString(), {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          kv: {
            chainId: network.chainId,
          },
        })
        const chain = networkToChain(network)
        const networkList = this.networkListByNetwork.get(network)!

        // Store network icon
        await db.transaction(async (tx) => {
          await db.fetchImageAndStoreForList(
            {
              listId: networkList.listId,
              uri: network.icon,
              originalUri: network.icon,
              providerKey: this.provider.key,
              signal,
            },
            tx,
          )
        })
        row.unmount()
      })

      // Process tokens
      type NetworkAndToken = {
        network: NetworkInfo
        token: TokenInfo
        globalOrderId: number
        scopedOrderId: number
      }
      const limit = promiseLimit<NetworkAndToken>(CONCURRENT_TOKENS)

      let globalOrderId = 0
      const allTokens = _.flatMap(this.networkData, (network) => {
        return network.tokens.map((tkn, i) => {
          return {
            network,
            token: tkn,
            globalOrderId: globalOrderId++,
            scopedOrderId: i,
          }
        })
      })

      await limit.map(allTokens, async ({ network, token, globalOrderId, scopedOrderId }) => {
        summaryRow.increment(terminalCounterTypes.TOKEN, `${network.chainId}-${token.address}`.toLowerCase())
        const row = tasksSection.task(`${network.chainId}-${token.address}`.toLowerCase(), {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          kv: {
            chainId: network.chainId,
            address: token.address,
          },
        })
        const address = viem.getAddress(token.address)
        const chain = networkToChain(network)
        const networkId = utils.chainIdToNetworkId(chain.id)

        // Check if token already has metadata in DB -- skip RPC if so
        const existingToken = await db
          .getDB()
          .from('token')
          .where({ providedId: address, networkId })
          .whereNot('name', '')
          .whereNot('symbol', '')
          .first<{ name: string; symbol: string; decimals: number }>()

        let name: string, symbol: string, decimals: number
        if (existingToken) {
          ;({ name, symbol, decimals } = existingToken)
        } else {
          try {
            const client = utils.chainToPublicClient(chain)
            const result = await erc20Read(chain, client, address)
            ;[name, symbol, decimals] = result
          } catch (err) {
            failureLog(`${providerKey} rpc failed %o %o: %o`, chain.id, address, (err as Error).message)
            row.increment('skipped', `${providerKey}-${network.chainId}-${token.address}`.toLowerCase())
            row.unmount()
            return
          }
        }

        const networkList = this.networkListByNetwork.get(network)!
        await db
          .transaction(async (tx) => {
            const insertion = {
              uri: token.icon,
              originalUri: token.icon,
              providerKey: this.provider.key,
              token: {
                symbol,
                name,
                decimals,
                networkId,
                providedId: address,
              },
            }
            await db.fetchImageAndStoreForToken(
              {
                ...insertion,
                listId: networkList.listId,
                listTokenOrderId: scopedOrderId,
                signal,
              },
              tx,
            )
            await db.fetchImageAndStoreForToken(
              {
                ...insertion,
                listId: this.insertedList.listId,
                listTokenOrderId: globalOrderId,
                signal,
              },
              tx,
            )
          })
          .catch((err) => {
            if (err.message?.toLowerCase()?.includes('timeout')) {
              row.increment('timeout', `${providerKey}-${network.chainId}-${token.address}`.toLowerCase())
            } else {
              row.increment('error', `${providerKey}-${network.chainId}-${token.address}`.toLowerCase())
            }
            failureLog(`${providerKey} ${chain.id} ${address} ${err.message}`)
          })
          .finally(() => {
            row.unmount()
          })
      })
    } finally {
      summaryRow.complete()
    }
  }
}

export default InternetMoneyCollector

/**
 * Main collection function that processes Internet Money networks and tokens
 */
export const collect = async (signal: AbortSignal) => {
  const collector = new InternetMoneyCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
