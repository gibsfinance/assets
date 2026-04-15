import * as cheerio from 'cheerio'
import * as fs from 'fs'
import { type Chain, type Address } from 'viem'
import { erc20Read, createChainClient } from '@gibs/utils/viem'
import { failureLog, limitBy } from '@gibs/utils'
import puppeteer, { type Browser } from 'puppeteer'
import puppeteerCore from 'puppeteer-core'
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
} from 'viem/chains'

import { delay } from '../utils/delay'
import { fetch } from '../fetch'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalLogTypes, TerminalRowProxy, terminalRowTypes } from '../log/types'
import * as path from 'path'
import * as paths from '../paths'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'etherscan'

const pageDir = path.join(paths.harvested, providerKey)

/**
 * Concurrency limiter for chain processing
 */
const chainLimiter = limitBy<ChainConfig>(`${providerKey}-chains`, 1)

/**
 * Concurrency limiter for puppeteer operations (more conservative)
 */
const puppeteerLimiter = limitBy<{ address: Address; logoURI?: string }[]>(`${providerKey}-puppeteer`, 1)

/**
 * Shared browser instance for puppeteer operations
 */
let sharedBrowser: Browser | null = null

/**
 * Get or create shared browser instance
 */
async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    const browserWSEndpoint = process.env.BROWSER_WS_ENDPOINT
    const launchTimeout = 15_000

    if (browserWSEndpoint) {
      failureLog('Connecting to external browser service: %o', browserWSEndpoint)
      sharedBrowser = await puppeteerCore.connect({
        browserWSEndpoint,
      })
    } else {
      failureLog('Launching local browser instance')
      const launchPromise = puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
        ],
      })
      let timer: ReturnType<typeof setTimeout>
      sharedBrowser = await Promise.race([
        launchPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Browser launch timed out — is Chrome/Chromium installed?')),
            launchTimeout,
          )
        }),
      ]).finally(() => clearTimeout(timer!))
    }
  }
  return sharedBrowser
}

/**
 * Close shared browser instance
 */
async function closeSharedBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    if (process.env.BROWSER_WS_ENDPOINT) {
      // For external browser service, just disconnect
      await sharedBrowser.disconnect()
    } else {
      // For local browser, close completely
      await sharedBrowser.close()
    }
    sharedBrowser = null
  }
}

/**
 * Sequential RPC processor for each chain to avoid rate limiting
 * Only allows one RPC call at a time per chain with 500ms delays
 */
class SequentialRpcProcessor {
  private chainProcessors = new Map<number, Promise<void>>()

  async processToken(
    chain: Chain,
    address: Address,
    signal: AbortSignal,
  ): Promise<{ name: string; symbol: string; decimals: number } | null> {
    const chainId = chain.id

    // Get or create the sequential processor for this chain
    if (!this.chainProcessors.has(chainId)) {
      this.chainProcessors.set(chainId, Promise.resolve())
    }

    const currentChainProcessor = this.chainProcessors.get(chainId)!

    // Create a promise for the actual RPC work (without delay)
    const rpcWork = currentChainProcessor.then(async () => {
      if (signal.aborted) throw new Error('Aborted')

      const client = createChainClient(chain)

      // Use multicall to batch name, symbol, decimals in one call
      const [name, symbol, decimals] = await erc20Read(chain, client, address)

      return { name, symbol, decimals }
    })

    // Create the next processor that includes the 500ms delay
    const nextProcessor = rpcWork.then(
      async (_result) => {
        // Wait 500ms before allowing the next request on this chain
        await delay(500, signal).catch(() => {})
        return // Return void for the processor chain
      },
      async (error) => {
        // Wait 500ms even on error to maintain rate limiting
        await delay(500, signal).catch(() => {})
        throw error
      },
    )

    // Update the processor chain
    this.chainProcessors.set(
      chainId,
      nextProcessor.catch(() => undefined),
    )

    // Return the RPC result immediately (without waiting for the delay)
    return rpcWork.catch((error) => {
      failureLog('Failed to fetch metadata for token %o on chain %o: %o', address, chainId, error.message)
      return null
    })
  }
}

const rpcProcessor = new SequentialRpcProcessor()

type ChainConfig = {
  chain: Chain
  explorerBaseUrl: string
  enabled: boolean
}

type EtherscanChainInfo = {
  chainname: string
  chainid: string
  blockexplorer: string
  apiurl: string
  status: number
  comment: string
}

/**
 * Fetches the list of supported chains from Etherscan's chainlist API
 */
async function fetchEtherscanChainList(signal: AbortSignal): Promise<EtherscanChainInfo[]> {
  const response = await fetch('https://api.etherscan.io/v2/chainlist', { signal })

  if (!response.ok) {
    throw new Error(`Etherscan chainlist API returned HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()

  if (!data.result || !Array.isArray(data.result)) {
    throw new Error('Invalid response format from Etherscan chainlist API')
  }

  return data.result
}

/**
 * Blacklisted chain IDs that should be excluded from collection
 */
const BLACKLISTED_CHAIN_IDS = new Set([
  1101, // OP Mainnet - deprecated or problematic
])

/**
 * Maps Etherscan chain info to our chain configurations
 */
function mapEtherscanChainToConfig(etherscanChain: EtherscanChainInfo): ChainConfig | null {
  const chainId = parseInt(etherscanChain.chainid)

  // Check if chain is blacklisted
  if (BLACKLISTED_CHAIN_IDS.has(chainId)) {
    return null
  }

  // Common chain mappings
  const chainMappings: Record<number, Chain> = {
    1: mainnet,
    10: optimism,
    56: bsc,
    137: polygon,
    42161: arbitrum,
    8453: base,
    43114: avalanche,
    250: fantom,
    25: cronos,
    42220: celo,
    1284: moonbeam,
    1285: moonriver,
    100: gnosis,
    2222: kava,
    288: boba,
    5000: mantle,
    59144: linea,
    534352: scroll,
    1101: polygonZkEvm,
    81457: blast,
  }

  const viemChain = chainMappings[chainId]

  if (!viemChain) {
    return null // Skip chains we don't have viem support for
  }

  return {
    chain: viemChain,
    explorerBaseUrl: etherscanChain.blockexplorer.replace(/\/$/, ''), // Remove trailing slash
    enabled: etherscanChain.status === 1, // Only enable if status is OK
  }
}

/**
 * Gets supported chain configurations from Etherscan API
 */
async function getSupportedChainConfigs(signal: AbortSignal): Promise<ChainConfig[]> {
  const etherscanChains = await fetchEtherscanChainList(signal)

  return etherscanChains
    .filter((chain) => {
      // Filter out testnets
      const isTestnet =
        chain.chainname.toLowerCase().includes('testnet') ||
        chain.chainname.toLowerCase().includes('sepolia') ||
        chain.chainname.toLowerCase().includes('goerli') ||
        chain.chainname.toLowerCase().includes('amoy') ||
        chain.chainname.toLowerCase().includes('cardona') ||
        chain.chainname.toLowerCase().includes('fuji') ||
        chain.chainname.toLowerCase().includes('alfajores')

      return !isTestnet && chain.status === 1 // Only active mainnets
    })
    .map(mapEtherscanChainToConfig)
    .filter((config): config is ChainConfig => config !== null) // Remove null entries
}

/**
 * Fetch tokens using puppeteer to bypass Cloudflare protection
 */
async function fetchTopTokensViaPuppeteer({
  explorerBaseUrl,
  chainId,
  signal,
  row,
}: {
  explorerBaseUrl: string
  chainId: number
  signal: AbortSignal
  row: TerminalRowProxy
}): Promise<{ address: Address; logoURI?: string }[]> {
  let page = null

  try {
    if (signal.aborted) throw new Error('Aborted')

    // Use shared browser instance
    const browser = await getSharedBrowser()
    page = await browser.newPage()

    // Set realistic browser settings
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    )
    await page.setViewport({ width: 1920, height: 1080 })

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    })

    const url = `${explorerBaseUrl}/tokens?sort=24h_volume_usd&order=desc&ps=100&apikey=${process.env.ETHERSCAN_API_KEY}`

    // Navigate to the page with timeout
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })
    await page.setViewport({
      width: 1080,
      height: 1024,
      deviceScaleFactor: 1,
    })

    await delay(3000, signal).catch(() => {})
    if (signal.aborted) return []
    // Check if we're still on a Cloudflare page
    const isCloudflareChallenge = await page.evaluate(() => {
      return (
        document.body.innerHTML.includes('Checking your browser') ||
        document.body.innerHTML.includes('DDoS protection') ||
        document.title.includes('Just a moment')
      )
    })

    if (isCloudflareChallenge) {
      // Wait for potential Cloudflare challenge to complete
      await delay(3000, signal).catch(() => {})
      if (signal.aborted) return []

      let count = 5
      while (count > 0) {
        if (signal.aborted) return []
        // Check if we're still on a Cloudflare page
        const isCloudflareChallenge = await page.evaluate(() => {
          return (
            document.body.innerHTML.includes('Checking your browser') ||
            document.body.innerHTML.includes('DDoS protection') ||
            document.title.includes('Just a moment')
          )
        })
        if (isCloudflareChallenge) {
          // Wait longer for Cloudflare challenge to complete
          await delay(10000, signal).catch(() => {})
          if (signal.aborted) return []
          count--
          continue
        }
        break
      }
    }

    // Get the page content
    const html = await page.content().catch(() => '')
    if (!html) {
      row.increment(terminalLogTypes.EROR, new Set([`${chainId}-puppeteer-error`]))
      return []
    }

    await fs.promises.mkdir(pageDir, { recursive: true })
    await fs.promises.writeFile(path.join(pageDir, `${chainId}.html`), html)

    // Parse with cheerio
    const $ = cheerio.load(html)
    const tokenData: { address: Address; logoURI?: string }[] = []

    // Parse token addresses and logos from the table
    const rows = $('tbody tr')
    rows.each((_, row) => {
      const $row = $(row)
      // Find token address link
      const tokenLink = $row.find('a[href*="/token/0x"]').first()
      const href = tokenLink.attr('href')

      if (href) {
        const match = href.match(/\/token\/(0x[a-fA-F0-9]{40})/)
        if (match && match[1]) {
          const address = match[1] as Address

          // Find token logo image in the same row
          const logoImg = $row.find('img').first()
          let logoURI: string | undefined

          if (logoImg.length > 0) {
            const src = logoImg.attr('src')
            if (src) {
              // Convert relative URLs to absolute URLs
              logoURI = src.startsWith('http') ? src : `${explorerBaseUrl}${src.startsWith('/') ? '' : '/'}${src}`
            }
          }

          // Check if we already have this address
          if (!tokenData.find((t) => t.address === address)) {
            tokenData.push({ address, logoURI })
          }
        }
      }
    })

    const finalTokenData = tokenData.slice(0, 100)
    return finalTokenData
  } catch (error) {
    row.increment(terminalLogTypes.EROR, new Set([`${chainId}-puppeteer-error`]))
    failureLog('Puppeteer failed for chain %o: %o', chainId, error)
    return []
  } finally {
    if (page) {
      await page.close()
      page = null
    }
  }
}

/**
 * Fetches the top 100 tokens by 24h volume from an etherscan-compatible explorer
 * Uses puppeteer to bypass Cloudflare protection
 */
async function fetchTopTokens({
  explorerBaseUrl,
  signal,
  row,
  chainId,
}: {
  explorerBaseUrl: string
  signal: AbortSignal
  row: TerminalRowProxy
  chainId: number
}): Promise<{ address: Address; logoURI?: string }[]> {
  // Use puppeteer with concurrency limiting to avoid overwhelming the system
  return puppeteerLimiter(async () => {
    return fetchTopTokensViaPuppeteer({
      explorerBaseUrl,
      chainId,
      signal,
      row,
    })
  })
}

/**
 * Fetches token metadata from the blockchain using RPC with sequential processing
 */
async function fetchTokenMetadata({
  chain,
  address,
  signal,
}: {
  chain: Chain
  address: Address
  signal: AbortSignal
}): Promise<{ name: string; symbol: string; decimals: number } | null> {
  return rpcProcessor.processToken(chain, address, signal)
}

/**
 * Processes tokens for a single chain
 */
async function processChainTokens({
  chainConfig,
  row,
  listId,
  signal,
}: {
  chainConfig: ChainConfig
  row: TerminalRowProxy
  listId: string
  providerId: string
  signal: AbortSignal
}): Promise<void> {
  const { chain, explorerBaseUrl } = chainConfig
  const chainKey = chain.name.toLowerCase().replace(/\s+/g, '-')

  try {
    // Upsert network to ensure it exists
    const network = await db.insertNetworkFromChainId(chain.id, 'evm')

    // Fetch top token data (addresses and logo URIs)
    const tokenData = await fetchTopTokens({
      explorerBaseUrl,
      signal,
      row,
      chainId: chain.id,
    })

    if (tokenData.length === 0) {
      failureLog('No tokens found for chain %o %o', chain.id, explorerBaseUrl)
      row.increment(terminalLogTypes.WARN, new Set([`${chain.id}-no-tokens`]))
      return
    }

    // Process tokens in batches for efficiency, separating token insertion from image fetching
    const section = row.get(providerKey)!

    // Collect all valid tokens with their metadata and URIs
    const validTokens: {
      address: `0x${string}`
      metadata: { symbol: string; name: string; decimals: number }
      logoURI: string | null
      index: number
    }[] = []

    for (const [index, { address, logoURI }] of tokenData.entries()) {
      const normalizedLogoURI = logoURI || null
      if (signal.aborted) break

      const chainTokenId = utils.counterId.token([chain.id, address])

      try {
        // Fetch token metadata from RPC
        const metadata = await fetchTokenMetadata({ chain, address, signal })

        if (!metadata) {
          row.increment(terminalLogTypes.EROR, new Set([chainTokenId]))
          continue
        }

        validTokens.push({ address, metadata, logoURI: normalizedLogoURI, index })
      } catch (error) {
        row.increment(terminalLogTypes.EROR, new Set([chainTokenId]))
        failureLog('Failed to fetch metadata for token %o on %o: %o', address, chainKey, error)
      }
    }

    if (validTokens.length === 0) {
      failureLog('No valid tokens found for chain %o', chainKey)
      return
    }

    // Batch insert tokens first (without images)
    const tokenInserts: Parameters<typeof db.insertToken>[0][] = validTokens.map(({ address, metadata }) => ({
      type: 'erc20',
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals,
      networkId: network.networkId,
      providedId: address,
    }))

    const tokensWithImages: {
      listTokenId: string
      uri: string | null
      originalUri: string | null
      providerKey: string
    }[] = []

    try {
      await db.insertTokenBatch(tokenInserts)

      // Create list associations for all inserted tokens
      for (const [batchIndex, token] of validTokens.entries()) {
        if (signal.aborted) break
        const chainTokenId = utils.counterId.token([chain.id, token.address])
        const task = section.task(`token-${chainKey}-${token.address.toLowerCase()}`, {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          kv: {
            address: token.address,
            type: 'evm',
            chainId: chain.id,
            chainKey,
          },
        })

        task.increment(terminalCounterTypes.TOKEN, new Set([chainTokenId]))

        try {
          // Use storeToken for list association (no image processing)
          const { listToken } = await db.storeToken({
            token: tokenInserts[batchIndex],
            listId,
            listTokenOrderId: token.index,
          })

          // Collect tokens that need image fetching
          if (token.logoURI) {
            tokensWithImages.push({
              listTokenId: listToken.listTokenId,
              uri: token.logoURI,
              originalUri: token.logoURI,
              providerKey,
            })
          }

          row.increment(terminalCounterTypes.TOKEN, chainTokenId)
        } catch (error) {
          row.increment(terminalLogTypes.EROR, new Set([chainTokenId]))
          failureLog('Failed to store token %o on %o: %o', token.address, chainKey, error)
        } finally {
          task.complete()
        }
      }
    } catch (error) {
      failureLog('Failed to batch insert tokens for chain %o: %o', chainKey, error)
      row.increment(terminalLogTypes.EROR, new Set([`${chain.id}-batch-insert-error`]))
      return
    }

    // Batch fetch images for tokens that have URIs
    if (tokensWithImages.length > 0) {
      try {
        await db.batchFetchImagesForTokens(
          tokensWithImages.map((item) => ({
            ...item,
            signal,
          })),
        )
        failureLog('Batch fetched images for %o tokens on chain %o', tokensWithImages.length, chainKey)
      } catch (error) {
        failureLog('Failed to batch fetch images for chain %o: %o', chainKey, error)
        // Don't fail the entire operation if image fetching fails
      }
    }

    row.increment(terminalCounterTypes.NETWORK, new Set([chain.id.toString()]))
  } catch (error) {
    row.increment(terminalLogTypes.EROR, new Set([`${chain.id}-chain-error`]))
  }
}

class EtherscanCollector extends BaseCollector {
  readonly key = 'etherscan'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'Etherscan',
    })
    const allNetworks = await db.insertNetworkFromChainId(0, 'evm')
    await db.insertList({
      providerId: provider.providerId,
      networkId: allNetworks.networkId,
      key: 'top-tokens',
      name: 'Top Tokens by Volume',
      default: true,
    })

    return [
      {
        providerKey,
        lists: [{ listKey: 'top-tokens' }],
      },
    ]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })

    try {
      // Insert provider
      const [provider] = await db.insertProvider({
        key: providerKey,
        name: 'Etherscan',
      })

      // Create list for all tokens
      const allNetworks = await db.insertNetworkFromChainId(0, 'evm')
      const [list] = await db.insertList({
        providerId: provider.providerId,
        networkId: allNetworks.networkId,
        key: 'top-tokens',
        name: 'Top Tokens by Volume',
        default: true,
      })

      // Get enabled chains from Etherscan API (fail if unavailable)
      const enabledChains = await getSupportedChainConfigs(signal)

      if (enabledChains.length === 0) {
        throw new Error(
          'Failed to fetch supported chains from Etherscan API. Cannot proceed without chain configuration.',
        )
      }
      // Setup counters
      row.issue(providerKey)
      row.createCounter(terminalCounterTypes.NETWORK)
      row.createCounter(terminalCounterTypes.TOKEN)
      row.createCounter(terminalLogTypes.EROR, true)
      row.createCounter(terminalLogTypes.WARN, true)

      row.incrementTotal(
        terminalCounterTypes.NETWORK,
        new Set(enabledChains.map((config) => config.chain.id.toString())),
      )

      // Process chains with limited concurrency (max 8 at a time)
      // Each chain handles its own rate limiting via SequentialRpcProcessor (500ms delays per chain)
      await chainLimiter.map(enabledChains, async (chainConfig) => {
        if (signal.aborted) return

        return processChainTokens({
          chainConfig,
          row,
          listId: list.listId,
          providerId: provider.providerId,
          signal,
        })
      })
    } catch (error) {
      failureLog('Etherscan collector failed: %o', error)
      throw error
    } finally {
      // Close shared browser instance
      await closeSharedBrowser()
      row.remove(providerKey)
      row.complete()
    }
  }
}

const instance = new EtherscanCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
