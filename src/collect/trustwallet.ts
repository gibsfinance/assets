/**
 * @title Trust Wallet Token List Collector
 * @notice Collects token information and images from Trust Wallet's blockchain assets
 * @dev Changes from original version:
 * 1. Replaced spinner with direct console status updates
 * 2. Added progress tracking for both folders and assets
 * 3. Improved error handling with continue instead of return in asset processing
 * 4. Added clear status messages for each operation phase
 * 5. Fixed variable naming conflicts with assets/assetData
 */

import * as fs from 'fs'
import * as db from '@/db'
import * as path from 'path'
import * as utils from '@/utils'
import * as types from '@/types'
import * as viem from 'viem'
import { Image } from 'knex/types/tables'

const providerKey = 'trustwallet'

const blockchainsRoot = path.join(utils.root, 'submodules', 'trustwallet', 'blockchains')
const assetsFolder = 'assets'

/**
 * @notice Main collection function that processes all blockchain folders
 * @dev Changes:
 * 1. Added folder processing progress tracking
 * 2. Implemented status updates for each blockchain folder
 * 3. Added completion message with newline
 */
export const collect = async () => {
  utils.updateStatus(`🔍 [${providerKey}] Reading blockchain folders...`)
  const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
  let processedFolders = 0

  for (const folder of blockchainFolders) {
    processedFolders++
    utils.updateStatus(
      `⚡ [${providerKey}] Processing blockchain ${processedFolders}/${blockchainFolders.length}: ${folder}`,
    )
    try {
      const f = path.join(blockchainsRoot, folder, assetsFolder)
      const assets = await fs.promises.readdir(f).catch(() => [])
      await entriesFromAssets(folder, utils.removedUndesirable(assets))
    } catch (err) {
      utils.failureLog(err)
    }
  }

  utils.updateStatus(`✨ [${providerKey}] Collection complete!`)
  process.stdout.write('\n')
}

/**
 * @notice Loads and parses token info and logo path from a directory
 * @param p The path to the directory containing info.json and logo.png
 * @return Promise<[Info, string]> Tuple of parsed info and logo path
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
 * @notice Processes assets for a specific blockchain and stores them in the database
 * @dev Changes:
 * 1. Added detailed status updates for each phase
 * 2. Implemented asset processing progress tracking
 * 3. Improved error handling for asset loading
 * 4. Fixed naming conflicts in asset processing loop
 * 5. Enhanced chainId detection with RPC fallback
 * @param blockchainKey The blockchain identifier
 * @param assets Array of asset addresses to process
 */
const entriesFromAssets = async (blockchainKey: string, assets: string[]) => {
  // https://assets-cdn.trustwallet.com/blockchains/ethereum/
  // const cdnPrefix = 'https://assets-cdn.trustwallet.com/blockchains'
  // const pathPrefix = `${cdnPrefix}/${blockchainKey}/${assetsFolder}/`
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [networkInfo, networkLogoPath] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch(() => null)

  if (!list) {
    return
  }

  const tokenList = JSON.parse(list.toString()) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId

  if (!chainId && networkInfo.rpc_url) {
    utils.updateStatus(`🔗 [${providerKey}] Checking chain ID from RPC for ${blockchainKey}...`)
    const client = viem.createPublicClient({
      transport: viem.http(networkInfo.rpc_url),
      batch: {
        multicall: {
          batchSize: 32,
          wait: 0,
        },
      },
    })
    chainId = await client.getChainId()
  }

  if (!chainId) {
    return
  }

  utils.updateStatus(`🏗️ [${providerKey}] Setting up provider and lists for ${blockchainKey}...`)
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

  utils.updateStatus(`🖼️ [${providerKey}] Storing network logo for ${blockchainKey}...`)
  const res = await db.fetchImageAndStoreForList({
    listId: networkList.listId,
    uri: networkLogoPath,
    originalUri: networkLogoPath,
    providerKey,
  })

  if (res) {
    const resWImage = res as { image: Image }
    await db.fetchImageAndStoreForList({
      listId: trustwalletList.listId,
      uri: resWImage.image ? resWImage.image.content : null,
      originalUri: networkLogoPath,
      providerKey,
    })
  }

  let processedAssets = 0
  const totalAssets = assets.length

  for (const asset of assets) {
    processedAssets++
    utils.updateStatus(`📥 [${providerKey}] Processing asset ${processedAssets}/${totalAssets}: ${asset}`)

    const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
    const assetData = await load(folder).catch(() => null)

    if (!assetData) {
      continue
    }

    const [info, logoPath] = assetData
    const address = asset as viem.Hex

    for (const list of [networkList, trustwalletList]) {
      const file = await db.fetchImage(logoPath, networkList.key)
      if (!file) continue

      utils.updateStatus(`💾 [${providerKey}] Storing token ${processedAssets}/${totalAssets}: ${info.symbol}...`)
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
}
