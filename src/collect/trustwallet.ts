import * as path from 'path'
import * as fs from 'fs'
import { createPublicClient, Hex, http, PublicClient } from 'viem'

import * as db from '@/db'
import * as types from '@/types'
import * as utils from '@/utils'
import * as paths from '@/paths'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '@/log/types'
import { failureLog } from 'packages/utils/src'
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
  for (const folder of blockchainFolders) {
    const chainId = networkNameToChainId.get(folder)
    if (!chainId) continue
    try {
      const f = path.join(blockchainsRoot, folder, assetsFolder)
      const assets = await fs.promises.readdir(f).catch(() => [])
      await entriesFromAssets(folder, utils.removedUndesirable(assets), signal)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      // console.log(errorMessage)
      failureLog('provider=%o folder=%o error=%o', providerKey, folder, errorMessage)
      row.increment(terminalLogTypes.EROR, `${providerKey}-${folder}`)
    }
    row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
  }
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

const loadChainId = async (blockchainKey: string) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [networkInfo, networkLogoPath] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  const row = utils.terminal.get(providerKey)!
  if (networkNameToChainId.has(blockchainKey)) {
    return
  }

  if (!list) {
    // use the blockchain key if we error out here because we do not yet have the chain id
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }

  const tokenList = JSON.parse(list.toString()) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId

  const getClient = _.memoize((): PublicClient => {
    return createPublicClient({
      transport: http(
        networkInfo.rpc_url === 'https://rpc.ftm.tools' ? 'https://fantom-rpc.publicnode.com' : networkInfo.rpc_url,
      ),
      batch: { multicall: { batchSize: 32, wait: 0 } },
    })
  })
  if (!chainId) {
    // console.log('provider=%o folder=%o chainId=%o', providerKey, blockchainKey, chainId)
    if (networkInfo.rpc_url) {
      chainId = await getClient().getChainId()
    }
  }

  if (!chainId) {
    // use the blockchain key if we error out here because we do not yet have the chain id
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }
  networkNameToChainId.set(blockchainKey, chainId)
}

/**
 * Processes assets for a specific blockchain and stores them in the database
 * @param blockchainKey The blockchain identifier
 * @param assets Array of asset addresses to process
 */
const entriesFromAssets = async (blockchainKey: string, assets: string[], signal: AbortSignal) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [networkInfo, networkLogoPath] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  const row = utils.terminal.get(providerKey)!

  if (!list) {
    // use the blockchain key if we error out here because we do not yet have the chain id
    row.increment(terminalLogTypes.EROR, `${providerKey}-${blockchainKey}`)
    return
  }

  const tokenList = JSON.parse(list.toString()) as types.TokenList
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

  const res = await db.fetchImageAndStoreForList({
    listId: networkList.listId,
    uri: networkLogoPath,
    originalUri: networkLogoPath,
    providerKey,
  })

  // let processedAssets = 0
  row.createCounter(terminalCounterTypes.TOKEN)
  row.incrementTotal(
    terminalCounterTypes.TOKEN,
    utils.mapToSet.token(assets, (a) => [chainId, a]),
  )
  // console.log('provider=%o folder=%o chainId=%o', providerKey, blockchainKey, chainId)
  for (const asset of assets) {
    if (signal.aborted) {
      return
    }
    const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
    const assetData = await load(folder).catch(() => null)

    const chainTokenId = utils.counterId.token([chainId, asset])
    if (!assetData) {
      row.increment('skipped', chainTokenId)
      continue
    }

    const [info, logoPath] = assetData
    const address = asset as Hex

    for (const list of [networkList, trustwalletList]) {
      const file = await db.fetchImage(logoPath, signal, providerKey, address)
      if (!file) {
        continue
      }

      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: file,
        originalUri: logoPath,
        providerKey,
        signal,
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
  }
}
