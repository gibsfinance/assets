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

const providerKey = 'trustwallet'
const blockchainsRoot = path.join(paths.submodules, providerKey, 'blockchains')
const assetsFolder = 'assets'

/**
 * Main collection function that processes all blockchain folders
 */
export const collect = async (signal: AbortSignal) => {
  const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
  const row = utils.terminal.issue({
    type: terminalRowTypes.SETUP,
    id: providerKey,
  })
  try {
    blockchainFolders.sort()
    // console.log(blockchainFolders)
    await Promise.all(blockchainFolders.map(loadChainId)).catch((err) => {
      failureLog('%o', (err as Error).message)
      return null
    })
    // console.log(networkNameToChainId)
    row.createCounter(terminalCounterTypes.NETWORK)
    row.incrementTotal(
      terminalCounterTypes.NETWORK,
      utils.mapToSet.network([...networkNameToChainId.values()], (chainId) => chainId),
    )
    let globalCount = 0
    const limit = limitBy<string>('blockchains', 1)
    await limit.map(blockchainFolders, async (folder) => {
      const chainId = networkNameToChainId.get(folder)
      if (!chainId) {
        // console.log('chain id not found', folder)
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
  const shouldLog = blockchainKey === 'arbitrum'
  const [
    networkInfo,
    // networkLogoPath,
  ] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  let chainId: number | null = null

  const chainList = await getChainListResult()
  const sterilizedBlockchainKey = sterilize(blockchainKey)
  const chain = chainList.find(
    (c) =>
      sterilize(c.name) === sterilizedBlockchainKey ||
      sterilize(c.chainSlug) === sterilizedBlockchainKey ||
      sterilize(c.chain) === sterilizedBlockchainKey,
  )
  const row = utils.terminal.get(providerKey)!
  // chain id from chain list is more trustworthy
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
    } else {
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
  // const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  // const list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  const row = utils.terminal.get(providerKey)!

  // if (!list) {
  // use the blockchain key if we error out here because we do not yet have the chain id
  // row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
  // return
  // }

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
