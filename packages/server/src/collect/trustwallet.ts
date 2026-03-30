import * as path from 'path'
import * as fs from 'fs'
import { createPublicClient, Hex, http, PublicClient } from 'viem'

import * as db from '../db'
import * as types from '../types'
import * as utils from '../utils'
import * as paths from '../paths'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '../log/types'
import { failureLog, limitBy } from '@gibs/utils'
import _ from 'lodash'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'trustwallet'
const blockchainsRoot = path.join(paths.submodules, providerKey, 'blockchains')
const assetsFolder = 'assets'

/**
 * Loads and parses token info and logo path from a directory
 * @param p The path to the directory containing info.json and logo.png
 * @return Tuple of parsed info and logo path
 */
const load = async (p: string) => {
  return await Promise.all([
    fs.promises.readFile(path.join(p, 'info.json')).then((info) => JSON.parse(info.toString()) as Info),
    path.join(p, 'logo.png'),
  ])
}

type Link = {
  name: string
  url: string
}

type Info = types.TokenEntry & {
  website?: string
  description?: string
  explorer?: string
  research?: string
  coin_type?: number
  status?: string
  rpc_url?: string
  tags?: string[]
  links: Link[]
}

const networkNameToChainId = new Map<string, number>([
  ['tron', 1000],
  ['solana', 900],
  ['xdai', 100],
  ['linea', 59144],
])

const getClient = _.memoize((url: string): PublicClient => {
  return createPublicClient({
    transport: http(url === 'https://rpc.ftm.tools' ? 'https://1rpc.io/ftm' : url, {
      timeout: 5_000,
    }),
    batch: { multicall: { batchSize: 32, wait: 0 } },
  })
})

type ChainList = {
  name: string
  chain: string
  faucets: string[]
  rpc: {
    url: string
    tracking: string
    isOpenSource?: boolean
  }[]
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  slip44: number
  networkId: number
  chainId: number
  chainSlug: string
}
const getChainListResult = _.memoize(async (): Promise<ChainList[]> => {
  const response = await fetch('https://chainlist.org/rpcs.json')
  if (!response.ok) {
    throw new Error(`Failed to fetch chain list: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as ChainList[]
  return data
})
const sterilize = _.memoize((s: string | null = '') =>
  s
    ?.toLowerCase()
    .split(' ')
    .join('')
    .split('-')
    .join('')
    .split('_')
    .join('')
    .split('.')
    .join('')
    .split('/')
    .join('')
    .split(':')
    .join('')
    .split('?')
    .join('')
    .split('&')
    .join('')
    .split('=')
    .join('')
    .split('evm')
    .join('')
    .split('chain')
    .join('')
    .split('network')
    .join('')
    .split('mainnet')
    .join('')
    .split('testnet')
    .join('')
    .split('devnet')
    .join('')
    .split('testnet')
    .join('')
    .split('net')
    .join(''),
)
const loadChainId = async (blockchainKey: string) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [
    networkInfo,
    // networkLogoPath,
  ] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  let chainId: number | null = null

  const chainList = await getChainListResult()
  const sterilizedBlockchainKey = sterilize(blockchainKey)
  // Sterilize is aggressive (strips "chain", "net", etc.) which can create
  // collisions — e.g. "smartchain" → "smart" matches "Smart Mainnet" (661898459)
  // instead of BNB Smart Chain (56). When multiple chains match, prefer the one
  // whose original name/slug contains the blockchain key as a substring.
  // Match chainSlug and name first (more specific), chain field last
  // (chain: "Solana" on Neon EVM would incorrectly match the solana folder)
  const candidates = chainList.filter(
    (c) => sterilize(c.chainSlug) === sterilizedBlockchainKey || sterilize(c.name) === sterilizedBlockchainKey,
  )
  // Only try the less-specific chain field if no slug/name matches found
  if (candidates.length === 0) {
    candidates.push(...chainList.filter((c) => sterilize(c.chain) === sterilizedBlockchainKey))
  }
  const chain =
    // Exact slug match first
    candidates.find((c) => c.chainSlug === blockchainKey) ||
    // Then prefer candidate whose name contains the key (ignoring spaces/separators)
    candidates.find(
      (c) =>
        c.name
          ?.toLowerCase()
          .replace(/[\s-_]/g, '')
          .includes(blockchainKey) ||
        c.chainSlug
          ?.toLowerCase()
          .replace(/[\s-_]/g, '')
          .includes(blockchainKey),
    ) ||
    // When ambiguous, prefer mainnet over testnet/devnet
    candidates.find((c) => {
      const n = c.name?.toLowerCase() ?? ''
      return !n.includes('testnet') && !n.includes('devnet')
    }) ||
    candidates[0]
  const row = utils.terminal.get(providerKey)!
  if (chain) {
    chainId = chain.chainId
  }

  if (!chainId) {
    let list = await fs.promises.readFile(tokenlistPath).catch(() => null)
    if (!list) {
      const tokenlistPath = path.join(blockchainsRoot, 'ethereum', 'tokenlist.json')
      list = await fs.promises.readFile(tokenlistPath)
      const parsed = JSON.parse(list.toString()) as types.TokenList
      parsed.tokens = []
      parsed.name = `Trust Wallet: ${blockchainKey}`
      list = Buffer.from(JSON.stringify(parsed))
    }
    if (!list) {
      row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
      return
    }

    const tokenList = JSON.parse(list.toString()) as types.TokenList
    chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId
  }

  if (!chainId) {
    if (networkInfo.rpc_url) {
      chainId = await getClient(networkInfo.rpc_url)
        .getChainId()
        .catch(() => null)
    }
  }

  if (!chainId) {
    // use the blockchain key if we error out here because we do not yet have the chain id
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }
  networkNameToChainId.set(blockchainKey, chainId)
}

type EntriesFromAssetsArgs = {
  blockchainKey: string
  assets: string[]
  signal: AbortSignal
  globalCount: number
}

/**
 * Processes assets for a specific blockchain and stores them in the database
 * @param blockchainKey The blockchain identifier
 * @param assets Array of asset addresses to process
 */
const entriesFromAssets = async ({ blockchainKey, assets, signal, globalCount }: EntriesFromAssetsArgs) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [, networkLogoPath] = await load(info)
  const row = utils.terminal.get(providerKey)!

  const chainId = networkNameToChainId.get(blockchainKey)!

  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'Trust Wallet',
  })

  const [trustwalletList] = await db.insertList({
    key: 'wallet',
    default: true,
    providerId: provider.providerId,
    patch: 1,
  })

  const key = `wallet-${blockchainKey}`
  const network = await db.insertNetworkFromChainId(chainId)
  const [networkList] = await db.insertList({
    providerId: provider.providerId,
    networkId: network.networkId,
    name: key,
    key,
    patch: 1,
  })

  const stat = await fs.promises.stat(networkLogoPath).catch(() => false)
  if (stat) {
    await db.fetchImageAndStoreForNetwork({
      network,
      uri: networkLogoPath,
      originalUri: networkLogoPath,
      providerKey,
      signal,
    })
    await db.fetchImageAndStoreForList({
      listId: networkList.listId,
      uri: networkLogoPath,
      originalUri: networkLogoPath,
      providerKey,
      signal,
    })
  }

  row.createCounter(terminalCounterTypes.TOKEN)
  row.incrementTotal(
    terminalCounterTypes.TOKEN,
    utils.mapToSet.token(assets, (a) => [chainId, a]),
  )
  const limit = limitBy<[number, string]>(`${providerKey}-${blockchainKey}-tokens`, 8)
  const entries = [...assets.entries()] as unknown as readonly [number, string][]
  await limit.map(entries, async ([i, asset]) => {
    if (signal.aborted) {
      return
    }
    const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
    const assetData = await load(folder).catch(() => null)

    const chainTokenId = utils.counterId.token([chainId, asset])
    if (!assetData) {
      row.increment('skipped', chainTokenId)
      return
    }

    const [info, logoPath] = assetData
    const address = asset as Hex
    const stat = await fs.promises.stat(logoPath).catch(() => false)
    if (!stat) {
      row.increment('skipped', chainTokenId)
      return
    }

    const file = await db.fetchImage(logoPath, signal, providerKey, address)
    if (!file) {
      row.increment('skipped', chainTokenId)
      return
    }
    const tokenData = {
      providedId: address,
      networkId: network.networkId,
      name: info.name,
      symbol: info.symbol,
      decimals: info.decimals,
    }
    await Promise.all([
      db.fetchImageAndStoreForToken({
        listId: networkList.listId,
        uri: file,
        originalUri: logoPath,
        providerKey,
        signal,
        listTokenOrderId: i,
        token: tokenData,
      }),
      db.fetchImageAndStoreForToken({
        listId: trustwalletList.listId,
        uri: file,
        originalUri: logoPath,
        providerKey,
        signal,
        listTokenOrderId: globalCount + i,
        token: tokenData,
      }),
    ])
    row.increment(terminalCounterTypes.TOKEN, chainTokenId)
  })
}

/**
 * Two-phase collector for Trust Wallet token assets.
 * Phase 1 (discover): scans filesystem submodule to enumerate blockchains, creates provider + lists.
 * Phase 2 (collect): processes token images from filesystem.
 */
class TrustWalletCollector extends BaseCollector {
  readonly key = 'trustwallet'

  private blockchainFolders: string[] = []

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })

    blockchainFolders.sort()
    await Promise.all(blockchainFolders.map(loadChainId)).catch((err) => {
      failureLog('%o', (err as Error).message)
      return null
    })

    // Create provider
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'Trust Wallet',
    })

    // Create the default wallet list
    await db.insertList({
      key: 'wallet',
      default: true,
      providerId: provider.providerId,
      patch: 1,
    })

    // Create per-blockchain lists and build manifest
    const lists: { listKey: string; listId?: string }[] = [{ listKey: 'wallet' }]
    for (const folder of blockchainFolders) {
      const chainId = networkNameToChainId.get(folder)
      if (!chainId) {
        continue
      }
      const network = await db.insertNetworkFromChainId(chainId)
      const key = `wallet-${folder}`
      const [networkList] = await db.insertList({
        providerId: provider.providerId,
        networkId: network.networkId,
        name: key,
        key,
        patch: 1,
      })
      lists.push({ listKey: key, listId: networkList.listId })
    }

    this.blockchainFolders = blockchainFolders
    // Row stays open for collect phase
    row.complete()

    return [{ providerKey, lists }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })
    try {
      row.createCounter(terminalCounterTypes.NETWORK)
      row.incrementTotal(
        terminalCounterTypes.NETWORK,
        utils.mapToSet.network([...networkNameToChainId.values()], (chainId) => chainId),
      )
      let globalCount = 0
      const limit = limitBy<string>('blockchains', 1)
      await limit.map(this.blockchainFolders, async (folder) => {
        const chainId = networkNameToChainId.get(folder)
        if (!chainId) {
          return
        }
        try {
          const f = path.join(blockchainsRoot, folder, assetsFolder)
          const assets = await fs.promises.readdir(f).catch(() => [])
          await entriesFromAssets({
            blockchainKey: folder,
            assets: utils.removedUndesirable(assets),
            signal,
            globalCount,
          })
          globalCount += assets.length
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          failureLog('provider=%o folder=%o error=%o', providerKey, folder, errorMessage)
          row.increment(terminalLogTypes.EROR, `${providerKey}-${folder}`)
        }
        row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
      })
    } finally {
      row.complete()
    }
  }
}

export default TrustWalletCollector

/**
 * Main collection function that processes all blockchain folders
 */
export const collect = async (signal: AbortSignal) => {
  const collector = new TrustWalletCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
