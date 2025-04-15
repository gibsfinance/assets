import * as path from 'path'
import * as fs from 'fs'
import { createPublicClient, Hex, http } from 'viem'

import * as db from '@/db'
import * as types from '@/types'
import * as utils from '@/utils'
import * as paths from '@/paths'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '@/log/types'

const providerKey = 'trustwallet'

const blockchainsRoot = path.join(paths.submodules, providerKey, 'blockchains')
const assetsFolder = 'assets'

/**
 * Main collection function that processes all blockchain folders
 */
export const collect = async () => {
  const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
  const row = utils.terminal.issue({
    type: terminalRowTypes.SETUP,
    id: providerKey,
  })
  row.createCounter(terminalCounterTypes.NETWORK, blockchainFolders.length)
  let accumulated = 0
  for (const folder of blockchainFolders) {
    row.increment(terminalCounterTypes.NETWORK)
    // section.set('networks', {
    //   message: 'Reading network folders',
    //   type: 'progress',
    //   current: processedFolders,
    //   total: blockchainFolders.length,
    //   kv: {
    //     chain: folder,
    //   },
    // })
    // processedFolders++
    // updateStatus({
    //   provider: providerKey,
    //   message: `Processing blockchain: ${folder}`,
    //   current: processedFolders,
    //   total: blockchainFolders.length,
    //   phase: 'processing',
    // } satisfies StatusProps)

    try {
      const f = path.join(blockchainsRoot, folder, assetsFolder)
      const assets = await fs.promises.readdir(f).catch(() => [])
      accumulated += assets.length
      await entriesFromAssets(folder, utils.removedUndesirable(assets), accumulated)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      row.increment(terminalLogTypes.EROR)
      // updateStatus({
      //   provider: providerKey,
      //   message: `Failed to process blockchain ${folder}: ${errorMessage}`,
      //   current: processedFolders,
      //   total: blockchainFolders.length,
      //   phase: 'processing',z
      // } satisfies StatusProps)
    }
  }
  row.complete()
  // section.increment('networks')
  // updateStatus({
  //   provider: providerKey,
  //   message: 'Collection complete!',
  //   phase: 'complete',
  // })
  // section.end('networks')
  // section.end('tokens')
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

/**
 * Processes assets for a specific blockchain and stores them in the database
 * @param blockchainKey The blockchain identifier
 * @param assets Array of asset addresses to process
 */
const entriesFromAssets = async (blockchainKey: string, assets: string[], accumulated: number) => {
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [networkInfo, networkLogoPath] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch(() => null)
  const row = utils.terminal.get(providerKey)

  if (!list) {
    row.increment(terminalLogTypes.EROR)
    return
  }

  const tokenList = JSON.parse(list.toString()) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId

  if (!chainId && networkInfo.rpc_url) {
    const client = createPublicClient({
      transport: http(networkInfo.rpc_url),
      batch: { multicall: { batchSize: 32, wait: 0 } },
    })
    chainId = await client.getChainId()
  }

  if (!chainId) {
    return
  }

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
  row.createCounter(terminalCounterTypes.TOKEN, accumulated)
  row.increment(terminalCounterTypes.TOKEN, accumulated - assets.length)
  for (const asset of assets) {
    row.increment(terminalCounterTypes.TOKEN)
    const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
    const assetData = await load(folder).catch(() => null)

    if (!assetData) {
      continue
    }

    const [info, logoPath] = assetData
    const address = asset as Hex

    for (const list of [networkList, trustwalletList]) {
      const file = await db.fetchImage(logoPath, networkList.key)
      if (!file) {
        continue
      }

      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: file,
        originalUri: logoPath,
        providerKey,
        token: {
          providedId: address,
          networkId: network.networkId,
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
        },
      })
    }
  }
  // section.increment('tokens')
}
