import { createPublicClient, http, type Chain, type Address } from 'viem'
import { erc20Read } from '@gibs/utils/viem'
import _ from 'lodash'
import { failureLog, limitBy } from '@gibs/utils'
import {
  mainnet,
  polygon,
  arbitrum,
  optimism,
  base,
  bsc,
  avalanche,
  fantom,
  cronos,
  celo,
  moonbeam,
  moonriver,
  gnosis,
  kava,
  boba,
  mantle,
  linea,
  scroll,
  polygonZkEvm,
  blast,
  polynomial,
  pulsechain,
} from 'viem/chains'

import { fetch } from '../fetch'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalLogTypes, TerminalRowProxy, terminalRowTypes } from '../log/types'

const providerKey = 'routescan'

/**
 * Delay utility to add pauses between requests
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Rate-limited chain processor for RouteScan
 * Ensures 500ms delay between requests while allowing controlled concurrency
 */
class RateLimitedChainProcessor {
  private lastRequestTime = 0
  private readonly minDelayMs = 500 // 2 RPS = 500ms between requests

  async processChain<T>(chain: Chain, processorFn: (chain: Chain) => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) {
      return null
    }

    const timeSinceLastRequest = Date.now() - this.lastRequestTime

    if (timeSinceLastRequest < this.minDelayMs) {
      const delayMs = this.minDelayMs - timeSinceLastRequest
      await delay(delayMs)
    }

    if (signal?.aborted) {
      return null
    }

    this.lastRequestTime = Date.now()
    return await processorFn(chain)
  }
}

const chainProcessor = new RateLimitedChainProcessor()

/**
 * Concurrency limiter for chain processing with rate limiting
 */
const chainLimiter = limitBy<Chain>(`${providerKey}-chains`, 1)

/**
 * Concurrency limiter for token processing (RPC calls and DB operations)
 */
const tokenLimiter = limitBy<boolean>(`${providerKey}-tokens`, 16)

/**
 * RouteScan API response types
 */
type RouteScanTokenItem = {
  chainId: string
  address: string
  name: string
  symbol: string
  decimals: number
  totalSupply: string
  price: string
  marketCap: string
  createOperation: {
    timestamp: string
    txHash: string
  }
  transfers: {
    last24h: number
    last48h: number
    last72h: number
  }
  holdersCount: number
}

type RouteScanResponse = {
  items: RouteScanTokenItem[]
  count: number
  countType: string
  link: {
    next: string
    nextToken: string
    prev: string
    prevToken: string
  }
}

/**
 * Fetches tokens from RouteScan API for a specific chain
 */
const oneHour = 1000 * 60 * 60

async function fetchRouteScanTokens({
  chainId,
  signal,
  limit = 100,
  nextToken
}: {
  chainId: number
  signal?: AbortSignal
  limit?: number
  nextToken?: string
}): Promise<RouteScanResponse> {
  const qs = new URLSearchParams({
    limit: limit.toString(),
    includedChainIds: chainId.toString(),
  })

  if (process.env.ROUTESCAN_API_KEY) {
    qs.set('apiKey', process.env.ROUTESCAN_API_KEY)
  }

  if (nextToken) {
    qs.set('nextToken', nextToken)
  }

  const cacheKey = `${providerKey}-tokens-${chainId}-${limit}-${nextToken ?? 'first'}`

  return db.cachedJSON<RouteScanResponse>(cacheKey, signal!, async () => {
    const url = `https://api.routescan.io/v2/network/mainnet/evm/all/erc20?${qs.toString()}`
    const response = await fetch(url, { signal })

    if (!response.ok) {
      throw new Error(`RouteScan API returned HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Invalid response format from RouteScan API')
    }

    return data
  }, { ttl: oneHour })
}


/**
 * Backfill missing token metadata using RPC calls
 */
async function backfillTokenMetadata({
  chain,
  address,
  signal,
}: {
  chain: Chain
  address: Address
  signal?: AbortSignal
}): Promise<{ name: string; symbol: string; decimals: number } | null> {
  try {
    const client = createPublicClient({
      chain,
      transport: http(),
    })

    const [name, symbol, decimals] = await erc20Read(chain, client, address)

    return { name, symbol, decimals }
  } catch (error) {
    failureLog('metadata fetch failed %o on chain %o: %o', address, chain.id, (error as Error).message)
    return null
  }
}

/**
 * Process a single token with metadata backfilling and database storage
 */
async function processToken({
  chain,
  tokenItem,
  address,
  network,
  globalListId,
  chainListId,
  providerId,
  signal,
  totalProcessed,
  row,
  chainKey,
}: {
  chain: Chain
  tokenItem: RouteScanTokenItem
  address: Address
  network: any
  globalListId: string
  chainListId: string
  providerId: string
  signal?: AbortSignal
  totalProcessed: number
  row: TerminalRowProxy
  chainKey: string
}): Promise<boolean> {
  const chainTokenId = utils.counterId.token([chain.id, address])

  try {
    // Check if we need to backfill missing metadata
    let tokenName = tokenItem.name
    let tokenSymbol = tokenItem.symbol
    let tokenDecimals = tokenItem.decimals

    if (!tokenName || !tokenSymbol || tokenDecimals === undefined) {
      const backfilledMetadata = await backfillTokenMetadata({
        chain,
        address,
        signal,
      })

      if (backfilledMetadata) {
        tokenName = tokenName || backfilledMetadata.name
        tokenSymbol = tokenSymbol || backfilledMetadata.symbol
        tokenDecimals = tokenDecimals !== undefined ? tokenDecimals : backfilledMetadata.decimals
      }
    }

    // Skip tokens that still don't have required metadata
    if (!tokenName || !tokenSymbol || tokenDecimals === undefined) {
      failureLog(`skipping token %o on %o - missing metadata: name=%o symbol=%o decimals=%o`, address, chainKey, tokenName, tokenSymbol, tokenDecimals)
      row.increment(terminalLogTypes.WARN, new Set([chainTokenId]))
      return false
    }

    // Store token in both global and chain-specific lists
    const tokenData = {
      type: 'erc20' as const,
      symbol: tokenSymbol,
      name: tokenName,
      decimals: tokenDecimals,
      networkId: network.networkId,
      providedId: address,
    }

    await Promise.all([
      db.storeToken({
        token: tokenData,
        listId: globalListId,
        listTokenOrderId: totalProcessed,
      }),
      db.storeToken({
        token: tokenData,
        listId: chainListId,
        listTokenOrderId: totalProcessed,
      }),
    ])

    row.increment(terminalCounterTypes.TOKEN, chainTokenId)
    return true

  } catch (error) {
    row.increment(terminalLogTypes.EROR, new Set([chainTokenId]))
    failureLog('token processing failed %o on %o: %o', address, chainKey, (error as Error).message)
    return false
  }
}

/**
 * Processes tokens for a single chain using RouteScan API with pagination support
 */
async function processChainTokens({
  chain,
  row,
  globalListId,
  providerId,
  signal,
}: {
  chain: Chain
  row: TerminalRowProxy
  globalListId: string
  providerId: string
  signal?: AbortSignal
}): Promise<void> {
  const chainKey = chain.name.toLowerCase().replace(/\s+/g, '-')

  try {
    // Upsert network to ensure it exists
    const network = await db.insertNetworkFromChainId(chain.id, 'evm')

    // Create chain-specific list
    const [chainList] = await db.insertList({
      providerId: providerId,
      networkId: network.networkId,
      key: `top-tokens-${chainKey}`,
      name: `Top Tokens by RouteScan - ${chain.name}`,
      default: false,
    })

    // Process tokens with pagination
    const section = row.get(providerKey)!
    let successCount = 0
    let totalProcessed = 0
    let nextToken: string | undefined
    const maxTokens = 500 // Limit total tokens per chain to avoid overwhelming the system

    while (totalProcessed < maxTokens && !signal?.aborted) {
      // Fetch tokens from RouteScan API
      const routeScanResponse = await fetchRouteScanTokens({
        chainId: chain.id,
        signal,
        limit: 100,
        nextToken
      })

      if (routeScanResponse.items.length === 0) {
        if (totalProcessed === 0) {
          // console.log(`No tokens found for chain ${chain.id}`)
          row.increment(terminalLogTypes.WARN, new Set([`${chain.id}-no-tokens`]))
        }
        break
      }

      // Process tokens in parallel with concurrency limiting
      const tokenPromises = routeScanResponse.items.map((tokenItem, index) => {
        if (signal?.aborted || totalProcessed + index >= maxTokens) return Promise.resolve(false)

        const address = tokenItem.address as Address
        const chainTokenId = utils.counterId.token([chain.id, address])

        const task = section.task(`token-${chainKey}-${address.toLowerCase()}`, {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          kv: {
            address,
            type: 'evm',
            chainId: chain.id,
            chainKey,
          },
        })

        task.increment(terminalCounterTypes.TOKEN, new Set([chainTokenId]))

        return tokenLimiter(() => processToken({
          chain,
          tokenItem,
          address,
          network,
          globalListId,
          chainListId: chainList.listId,
          providerId,
          signal,
          totalProcessed: totalProcessed + index,
          row,
          chainKey,
        }))
      })

      const results = await Promise.all(tokenPromises)
      const batchSuccessCount = results.filter(Boolean).length
      successCount += batchSuccessCount
      totalProcessed += routeScanResponse.items.length

      // Check if there are more pages
      if (routeScanResponse.link.next && routeScanResponse.link.nextToken) {
        nextToken = routeScanResponse.link.nextToken
      } else {
        break // No more pages
      }
    }

    row.increment(terminalCounterTypes.NETWORK, new Set([chain.id.toString()]))
    // console.log(`Processed ${successCount}/${totalProcessed} tokens for ${chainKey}`)

  } catch (error) {
    row.increment(terminalLogTypes.EROR, new Set([`${chain.id}-chain-error`]))
    failureLog('chain processing failed %o: %o', chainKey, (error as Error).message)
  }
}

/**
 * RouteScan blockchain info from API
 */
type RouteScanBlockchain = {
  name: string
  chainId: string
  evmChainId: string
  avalancheBlockchainId: string
  logo: string
  logoUrls: {
    "32": string
    "64": string
    "256": string
    "1024": string
  }
  icon: string
  iconUrls: {
    "32": string
    "64": string
    "256": string
    "1024": string
  }
  symbol: string
  rpcs: string[]
  coingeckoId: string
  avascanId: string
  ecosystems: string[]
  socialProfile: {
    items: Array<{
      type: string
      value: string
      title: string
    }>
  }
  description: string
  tags: string[]
  freeApiRateLimit: {
    rps: number
    rpd: number
  }
}

type RouteScanBlockchainsResponse = {
  items: RouteScanBlockchain[]
  link: {
    next: string
    nextToken: string
    prev: string
    prevToken: string
  }
}

/**
 * Fetch supported blockchains from RouteScan API
 */
async function fetchRouteScanBlockchains(signal?: AbortSignal): Promise<RouteScanBlockchain[]> {
  return db.cachedJSON<RouteScanBlockchain[]>(`${providerKey}-blockchains`, signal!, async () => {
    const response = await fetch(`https://api.routescan.io/v2/network/mainnet/evm/all/blockchains?ecosystem=ethereum`, { signal })

    if (!response.ok) {
      throw new Error(`RouteScan blockchains API returned HTTP ${response.status}: ${response.statusText}`)
    }

    const data: RouteScanBlockchainsResponse = await response.json()

    if (!data.items || !Array.isArray(data.items)) {
      throw new Error('Invalid response format from RouteScan blockchains API')
    }

    return data.items
  }, { ttl: oneHour })
}

/**
 * Map RouteScan blockchain to our chain configuration
 * Filters out networks with 0 RPS (not queryable)
 */
function mapRouteScanBlockchainToConfig(blockchain: RouteScanBlockchain): Chain | null {
  // Skip networks with 0 RPS - they are not queryable
  if (blockchain.freeApiRateLimit.rps === 0) {
    return null
  }

  // Parse chainId from string to number
  const chainId = parseInt(blockchain.chainId)
  if (isNaN(chainId)) {
    return null
  }

  // Find matching viem chain
  const chainMappings: Record<number, Chain> = {
    1: mainnet,
    10: optimism,
    42161: arbitrum,
    288: boba,
    8008: polynomial,
    369: pulsechain,
  }

  const viemChain = chainMappings[chainId]
  if (!viemChain) {
    failureLog('unsupported chain %o (%o) from RouteScan', chainId, blockchain.name)
    return null // Skip chains we don't have viem support for
  }

  return viemChain
}

/**
 * Get supported chain configurations from RouteScan API
 */
async function getRouteScanChainConfigs(signal?: AbortSignal): Promise<Chain[]> {
  const blockchains = await fetchRouteScanBlockchains(signal)

  return _(blockchains)
    .map(mapRouteScanBlockchainToConfig)
    .compact().value()
}

/**
 * Main collector function
 */
export const collect = async (signal?: AbortSignal) => {
  const row = utils.terminal.issue({
    type: terminalRowTypes.SETUP,
    id: providerKey,
  })

  try {
    // Insert provider
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'RouteScan',
    })

    // Create global list for all tokens across all chains
    const allNetworks = await db.insertNetworkFromChainId(0, 'evm')
    const [globalList] = await db.insertList({
      providerId: provider.providerId,
      networkId: allNetworks.networkId,
      key: 'top-tokens',
      name: 'Top Tokens by RouteScan',
      default: true,
    })

    // Get supported chain configurations from RouteScan API
    const enabledChains = await getRouteScanChainConfigs(signal)

    if (enabledChains.length === 0) {
      throw new Error('Failed to fetch supported chains from RouteScan API. Cannot proceed without chain configuration.')
    }
    // Setup counters
    const section = row.issue(providerKey)
    row.createCounter(terminalCounterTypes.NETWORK)
    row.createCounter(terminalCounterTypes.TOKEN)
    row.createCounter(terminalLogTypes.EROR, true)
    row.createCounter(terminalLogTypes.WARN, true)

    row.incrementTotal(
      terminalCounterTypes.NETWORK,
      new Set(enabledChains.map(config => config.id.toString()))
    )

    // Process chains with rate-limited concurrency
    await chainLimiter.map(enabledChains, async (chainConfig) => {
      if (signal?.aborted) return

      return chainProcessor.processChain(
        chainConfig,
        async (chain) => {
          return processChainTokens({
            chain,
            row,
            globalListId: globalList.listId,
            providerId: provider.providerId,
            signal,
          })
        },
        signal
      )
    })

  } catch (error) {
    failureLog('RouteScan collector failed: %o', (error as Error).message)
    throw error
  } finally {
    row.remove(providerKey)
    row.complete()
  }
}
