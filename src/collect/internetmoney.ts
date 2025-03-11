/**
 * @title Internet Money Token List Collector
 * @notice Collects token information from Internet Money's API
 * @dev Changes from original version:
 * 1. Replaced spinner with detailed status updates
 * 2. Added progress tracking for total tokens across networks
 * 3. Improved transaction handling with clear phases
 * 4. Enhanced error handling for network processing
 * 5. Added controlled parallel processing for better performance
 */

import * as db from '@/db'
import { Tx } from '@/db/tables'
import { fetch } from '@/fetch'
import * as utils from '@/utils'
import type { List, Provider } from 'knex/types/tables'
import promiseLimit from 'promise-limit'
import * as viem from 'viem'
import * as chains from 'viem/chains'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'

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

/**
 * @notice Main collection function that processes Internet Money networks and tokens
 * @dev Changes:
 * 1. Added phase-specific status messages (setup, network, tokens)
 * 2. Implemented token count tracking across all networks
 * 3. Added controlled parallel processing with concurrency limit
 * 4. Enhanced network icon storage with clear status updates
 */
export const collect = async () => {
  updateStatus({
    provider: 'internetmoney',
    message: 'Fetching network list...',
    phase: 'setup',
  } satisfies StatusProps)

  const json = await fetch(baseUrl)
    .then((res): Promise<NetworkInfo[]> => res.json())
    .then((res) => (Array.isArray(res) ? res : []))
  const encounteredChainIds = new Set<bigint>()
  let provider!: Provider
  let insertedList!: List

  updateStatus({
    provider: 'internetmoney',
    message: 'Setting up provider and list...',
    phase: 'setup',
  } satisfies StatusProps)
  await db.transaction(async (tx) => {
    ;[provider] = await db.insertProvider(
      {
        name: 'Internet Money',
        key: 'internetmoney',
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

  let processedTokens = 0
  for (const network of json) {
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

    updateStatus({
      provider: 'internetmoney',
      message: `Processing chain ${chain.id}...`,
      current: processedTokens,
      total: totalTokens,
      phase: 'processing',
    } satisfies StatusProps)
    await db.insertNetworkFromChainId(chain.id)

    const client = viem.createClient({
      transport: viem.http(),
      chain,
    })
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
    await db.transaction(async (tx) => {
      const [networkList] = await insertAndGetNetworkList(tx)
      updateStatus({
        provider: 'internetmoney',
        message: `Storing network icon for chain ${chain.id}...`,
        current: processedTokens,
        total: totalTokens,
        phase: 'storing',
      } satisfies StatusProps)
      await db.fetchImageAndStoreForList(
        {
          listId: networkList.listId,
          uri: network.icon,
          originalUri: network.icon,
          providerKey: provider.key,
        },
        tx,
      )
    })

    // Process tokens in parallel with controlled concurrency
    const limit = promiseLimit<TokenInfo>(CONCURRENT_TOKENS)
    await limit.map(network.tokens, async (token) => {
      processedTokens++
      updateStatus({
        provider: 'internetmoney',
        message: `Processing token: ${token.address}`,
        current: processedTokens,
        total: totalTokens,
        phase: 'processing',
      } satisfies StatusProps)

      try {
        const address = viem.getAddress(token.address)
        const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)

        await db.transaction(async (tx) => {
          const [networkList] = await insertAndGetNetworkList(tx)
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

          updateStatus({
            provider: 'internetmoney',
            message: `Storing token: ${symbol}`,
            current: processedTokens,
            total: totalTokens,
            phase: 'storing',
          } satisfies StatusProps)
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
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        updateStatus({
          provider: 'internetmoney',
          message: `Failed to process token ${token.address} on chain ${chain.id}: ${errorMessage}`,
          current: processedTokens,
          total: totalTokens,
          phase: 'complete',
        } satisfies StatusProps)
      }
    })
  }

  updateStatus({
    provider: 'internetmoney',
    message: `Completed processing ${totalTokens} tokens!`,
    phase: 'complete',
  } satisfies StatusProps)
}
