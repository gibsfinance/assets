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
  await Promise.all(blockchainFolders.map(loadChainId)).catch((err) => {
    console.error(err)
    return null
  })
  row.createCounter(terminalCounterTypes.NETWORK)
  row.incrementTotal(
    terminalCounterTypes.NETWORK,
    utils.mapToSet.network([...networkNameToChainId.values()], (chainId) => chainId),
  )
  let globalCount = 0
  const limit = limitBy<string>('blockchains', 16)
  await limit.map(blockchainFolders, async (folder) => {
    const chainId = networkNameToChainId.get(folder)
    if (!chainId) return
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
  row.complete()
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
    transport: http(
      url === 'https://rpc.ftm.tools' ? 'https://1rpc.io/ftm' : url,
      {
        timeout: 5_000,
      },
    ),
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
  }[],
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
  const data = await response.json() as ChainList[]
  return data
})
const sterilize = _.memoize((s: string | null = '') => s?.toLowerCase().split(' ').join('')
  .split('-').join('')
  .split('_').join('')
  .split('.').join('')
  .split('/').join('')
  .split(':').join('')
  .split('?').join('')
  .split('&').join('')
  .split('=').join('')
  .split('evm').join('')
  .split('chain').join('')
  .split('network').join('')
  .split('mainnet').join('')
  .split('testnet').join('')
  .split('devnet').join('')
  .split('testnet').join('')
  .split('net').join('')
)
const loadChainId = async (blockchainKey: string) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [
    networkInfo,
    // networkLogoPath,
  ] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  let list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  if (!list) {
    const tokenlistPath = path.join(blockchainsRoot, 'ethereum', 'tokenlist.json')
    list = await fs.promises.readFile(tokenlistPath)
    const parsed = JSON.parse(list.toString()) as types.TokenList
    parsed.tokens = []
    parsed.name = `Trust Wallet: ${blockchainKey}`
    list = Buffer.from(JSON.stringify(parsed))
  }
  const row = utils.terminal.get(providerKey)!
  if (networkNameToChainId.has(blockchainKey)) {
    return
  }

  if (!list) {
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }

  const tokenList = JSON.parse(list.toString()) as types.TokenList
  let chainId: number | null = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId

  if (!chainId) {
    const chainList = await getChainListResult()
    const sterilizedBlockchainKey = sterilize(blockchainKey)
    const chain = chainList.find((c) => (
      sterilize(c.name) === sterilizedBlockchainKey
      || sterilize(c.chainSlug) === sterilizedBlockchainKey
      || sterilize(c.chain) === sterilizedBlockchainKey
    ))
    if (chain) {
      chainId = chain.chainId
    }
  }

  if (!chainId) {
    // console.log('provider=%o folder=%o chainId=%o', providerKey, blockchainKey, chainId)
    if (networkInfo.rpc_url) {
      chainId = await getClient(networkInfo.rpc_url).getChainId().catch(() => null)
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
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  const row = utils.terminal.get(providerKey)!

  if (!list) {
    // use the blockchain key if we error out here because we do not yet have the chain id
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }

  // const tokenList = JSON.parse(list.toString()) as types.TokenList
  const chainId = networkNameToChainId.get(blockchainKey)!

  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'Trust Wallet',
  })

  const [trustwalletList] = await db.insertList({
    key: 'wallet',
    default: true,
    providerId: provider.providerId,
  })

  const key = `wallet-${blockchainKey}`
  const network = await db.insertNetworkFromChainId(chainId)
  const [networkList] = await db.insertList({
    providerId: provider.providerId,
    networkId: network.networkId,
    name: key,
    key,
  })

  if (await fs.promises.stat(networkLogoPath).catch(() => false)) {
    await db.fetchImageAndStoreForList({
      listId: networkList.listId,
      uri: networkLogoPath,
      originalUri: networkLogoPath,
      providerKey,
    })
  }

  row.createCounter(terminalCounterTypes.TOKEN)
  row.incrementTotal(
    terminalCounterTypes.TOKEN,
    utils.mapToSet.token(assets, (a) => [chainId, a]),
  )
  const limit = limitBy<[number, string]>(`${providerKey}-${blockchainKey}-tokens`, 16)
  const entries = [...assets.entries()] as unknown as readonly [number, string][]
  await limit.map(entries, async ([i, asset]) => {
    // for (const [i, asset] of assets.entries()) {
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

    const file = await db.fetchImage(logoPath, signal, providerKey, address)
    if (!file) {
      row.increment('skipped', chainTokenId)
      return
    }
    for (const [list, index] of [[networkList, i], [trustwalletList, globalCount + i]] as const) {
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: file,
        originalUri: logoPath,
        providerKey,
        signal,
        listTokenOrderId: index,
        token: {
          providedId: address,
          networkId: network.networkId,
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
        },
      })
    }
    row.increment(terminalCounterTypes.TOKEN, chainTokenId)
  })
}
